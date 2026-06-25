/**
 * 知识库向量灌入脚本（spec 015）。
 * 读取 knowledge/chunks.json，计算 embedding 后写入 Cloudflare Vectorize 索引。
 *
 * 用法：
 *   export CLOUDFLARE_API_TOKEN=xxx  CLOUDFLARE_ACCOUNT_ID=xxx
 *   npm run populate-vectorize
 *
 * 或利用 wrangler OAuth 自动获取凭据。
 * 支持幂等：重复运行不会重复插入（按 vector ID 覆盖）。
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';

// ── Types ──────────────────────────────────────────────────────────────────

interface Chunk {
  text: string;
  source_doc: string;
  section_title: string;
  chunk_index: number;
}

// ── Config ─────────────────────────────────────────────────────────────────

const KNOWLEDGE_DIR = resolve(__dirname, '../knowledge');
const CHUNKS_FILE = resolve(KNOWLEDGE_DIR, 'chunks.json');
const CACHE_FILE = resolve(KNOWLEDGE_DIR, 'embeddings.json');
const INDEX_NAME = 'knowledge_index';

const EMBEDDING_MODEL = '@cf/baai/bge-m3';

// ── 凭据 ──────────────────────────────────────────────────────────────────

interface Creds { token: string; accountId: string }

async function loadCredentials(): Promise<Creds> {
  const envToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
  const envAccount = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  if (envToken && envAccount) return { token: envToken, accountId: envAccount };

  // 从 wrangler OAuth 配置读 token
  const wranglerCandidates = [
    join(homedir(), '.wrangler', 'config/default.toml'),
    join(homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),
    join(homedir(), 'AppData/Roaming/.wrangler/config/default.toml'),
  ];
  let token = envToken;
  if (!token) {
    for (const p of wranglerCandidates) {
      if (!existsSync(p)) continue;
      const raw = readFileSync(p, 'utf-8');
      const m = raw.match(/oauth_token\s*=\s*"([^"]+)"/);
      if (m) { token = m[1]; console.error('✅ 自动检测 wrangler OAuth Token'); break; }
    }
  }
  if (!token) { console.error('❌ 无法获取 Cloudflare 凭据，请设置 CLOUDFLARE_API_TOKEN'); process.exit(1); }

  if (envAccount) return { token, accountId: envAccount };

  console.error('正在查询 Account ID…');
  const resp = await fetch('https://api.cloudflare.com/client/v4/accounts', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = (await resp.json()) as { result?: Array<{ id: string; name: string }> };
  if (!data.result?.length) { console.error('❌ 未找到 Account'); process.exit(1); }
  console.error(`   账号: ${data.result[0].name} (${data.result[0].id})`);
  return { token, accountId: data.result[0].id };
}

// ── Embedding ──────────────────────────────────────────────────────────────

async function embedBatch(texts: string[], creds: Creds): Promise<number[][]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/run/${EMBEDDING_MODEL}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Embedding 错误 (${resp.status}): ${err.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { result?: { data?: number[][] } };
  if (!data.result?.data || data.result.data.length !== texts.length) {
    throw new Error(`向量数量不匹配: 期望 ${texts.length}, 实际 ${data.result?.data?.length ?? 0}`);
  }
  return data.result.data;
}

// ── Vectorize REST API ────────────────────────────────────────────────────

async function getVectorCount(creds: Creds): Promise<number> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/vectorize/v2/indexes/${INDEX_NAME}`;
  const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${creds.token}` } });
  if (!resp.ok) return 0; // 可能还不存在
  const data = (await resp.json()) as { result?: { vectorCount?: number } };
  return data.result?.vectorCount ?? 0;
}

async function upsertVectors(vectors: Array<{ id: string; values: number[]; metadata: Record<string, unknown> }>, creds: Creds): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/vectorize/v2/indexes/${INDEX_NAME}/upsert`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vectors }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Vectorize upsert 错误 (${resp.status}): ${err.slice(0, 300)}`);
  }
  const data = (await resp.json()) as { success?: boolean; errors?: Array<{ message: string }> };
  if (!data.success) {
    throw new Error(`Vectorize upsert 失败: ${data.errors?.[0]?.message ?? 'unknown'}`);
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const creds = await loadCredentials();

  // 1. 加载 chunks
  if (!existsSync(CHUNKS_FILE)) {
    console.error(`❌ 未找到 ${CHUNKS_FILE}，请先运行 npm run ingest-knowledge`);
    process.exit(1);
  }
  const chunks: Chunk[] = JSON.parse(readFileSync(CHUNKS_FILE, 'utf-8'));
  const totalChars = chunks.reduce((s, c) => s + c.text.length, 0);
  console.log(`📚 ${chunks.length} 个 chunks（${totalChars.toLocaleString()} 字符）`);

  // 2. 检查已有向量数量
  const existingCount = await getVectorCount(creds);
  if (existingCount > 0) {
    console.log(`  索引中已有 ${existingCount} 条向量，将覆盖更新（幂等）`);
  }

  // 3. 计算 embeddings（复用缓存，避免重复调用 API）
  let chunkVecs: number[][] | null = null;
  const cacheFile = CACHE_FILE;
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf-8'));
    if (cached.chunks?.length === chunks.length &&
        cached.chunks.every((t: string, i: number) => t === chunks[i].text)) {
      chunkVecs = cached.vectors;
      console.log('  embedding 缓存命中');
    }
  }

  if (!chunkVecs) {
    console.log('  计算 embeddings…');
    chunkVecs = [];
    const BATCH_SIZE = 3;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE).map(c => c.text);
      process.stdout.write(`  batch ${i / BATCH_SIZE + 1}/${Math.ceil(chunks.length / BATCH_SIZE)}…`);
      const vectors = await embedBatch(batch, creds);
      chunkVecs.push(...vectors);
      console.error(` done`);
    }
    // 缓存
    writeFileSync(cacheFile, JSON.stringify({ chunks: chunks.map(c => c.text), vectors: chunkVecs }));
    console.log('  embedding 缓存已保存');
  }

  // 4. 组装向量并分批 upsert（chunk._id 由 ingest 脚本生成，与 D1 和 SQL 对齐）
  const vectors = chunks.map((chunk, i) => {
    const chunkId = (chunk as any)._id || i + 1;
    return {
      id: `chunk_${chunkId}`,
      values: chunkVecs![i],
      metadata: {
        chunk_id: chunkId,
        source_doc: chunk.source_doc,
        section_title: chunk.section_title,
      },
    };
  });

  console.log(`  正在写入 Vectorize 索引 (${vectors.length} 条)…`);

  const UPSERT_BATCH = 50;
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
    const batch = vectors.slice(i, i + UPSERT_BATCH);
    process.stdout.write(`  upsert batch ${i / UPSERT_BATCH + 1}/${Math.ceil(vectors.length / UPSERT_BATCH)}…`);
    await upsertVectors(batch, creds);
    console.error(` ✅`);
  }

  // 5. 验证
  console.error('\n✅ 灌入完成！14 条向量已写入索引 "knowledge_index"');
  console.log(`\n下一步：`);
  console.log(`  1. npm run dev 启动本地 Bot`);
  console.log(`  2. 在 Telegram 中询问知识库相关的问题`);
}

main().catch(e => {
  console.error(`\n❌ 错误: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
