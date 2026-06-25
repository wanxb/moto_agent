/**
 * 离线知识库检索测试脚本（spec 015 RAG）。
 *
 * 读取 knowledge/chunks.json，通过 Workers AI REST API 计算 embedding，
 * 用余弦相似度做本地向量检索，验证召回质量。
 *
 * 用法：
 *   1. 设置环境变量（任选一种）：
 *      export CLOUDFLARE_API_TOKEN=xxx  CLOUDFLARE_ACCOUNT_ID=xxx
 *      或从 .dev.vars 加载（如果设了 CF_API_TOKEN / CF_ACCOUNT_ID）
 *
 *   2. 单次查询：
 *      npx tsx scripts/test-knowledge.ts "NS125LA 胎压多少"
 *
 *   3. 交互式模式（连续问答）：
 *      npx tsx scripts/test-knowledge.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { createInterface } from 'readline';
import { homedir } from 'os';

// ── Types ──────────────────────────────────────────────────────────────────

interface Chunk {
  text: string;
  source_doc: string;
  section_title: string;
  chunk_index: number;
}

interface CachedEmbeddings {
  chunks: string[];        // 每个 chunk 的 text，用于校验缓存是否过期
  vectors: number[][];     // 对应的 1024 维向量
}

// ── Config ─────────────────────────────────────────────────────────────────

const KNOWLEDGE_DIR = resolve(__dirname, '../knowledge');
const CHUNKS_FILE = resolve(KNOWLEDGE_DIR, 'chunks.json');
const CACHE_FILE = resolve(KNOWLEDGE_DIR, 'embeddings.json');

/** 从 wrangler OAuth 配置或环境变量获取凭据，自动查询 Account ID */
async function loadCredentials(): Promise<{ token: string; accountId: string }> {
  // 1. 优先环境变量
  const envToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
  const envAccount = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  if (envToken && envAccount) return { token: envToken, accountId: envAccount };

  // 2. 从 wrangler 的 OAuth 配置读取 token（自动扫描常见路径）
  const wranglerCandidates = [
    join(homedir(), '.wrangler', 'config/default.toml'),
    join(homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'),
    join(homedir(), 'AppData/Roaming/.wrangler/config/default.toml'),
    process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, '.wrangler/config/default.toml') : '',
  ].filter(Boolean);
  const wranglerConfig = wranglerCandidates.find(f => existsSync(f)) || '';

  let token = envToken;
  if (!token && existsSync(wranglerConfig)) {
    const raw = readFileSync(wranglerConfig, 'utf-8');
    const m = raw.match(/oauth_token\s*=\s*"([^"]+)"/);
    if (m) {
      token = m[1];
      console.error('✅ 自动检测到 wrangler OAuth Token');
    }
  }

  if (!token) {
    console.error('❌ 无法获取 Cloudflare 凭据。请运行 wrangler login 或设置：');
    console.error('   CLOUDFLARE_API_TOKEN=xxx  CLOUDFLARE_ACCOUNT_ID=xxx');
    process.exit(1);
  }

  // 3. 用 token 自动查 Account ID（如环境变量未提供）
  if (envAccount) return { token, accountId: envAccount };

  console.error('正在通过 API 查询 Account ID…');
  const resp = await fetch('https://api.cloudflare.com/client/v4/accounts', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!resp.ok) {
    console.error(`❌ 查询 Account ID 失败 (${resp.status})，请手动设置环境变量：`);
    console.error('   CLOUDFLARE_ACCOUNT_ID=xxx  npm run test-knowledge');
    process.exit(1);
  }
  const data = (await resp.json()) as { result?: Array<{ id: string; name: string }> };
  if (!data.result?.length) {
    console.error('❌ 未找到 Account，请检查 wrangler 权限');
    process.exit(1);
  }
  console.error(`   账号: ${data.result[0].name} (${data.result[0].id})`);
  return { token, accountId: data.result[0].id };
}

// ── Embedding ──────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = '@cf/baai/bge-m3';

let _CF_TOKEN = '';
let _CF_ACCOUNT_ID = '';

/** 通过 Workers AI REST API 计算文本列表的 embeddings（支持批量） */
async function embedBatch(texts: string[]): Promise<number[][]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${_CF_ACCOUNT_ID}/ai/run/${EMBEDDING_MODEL}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${_CF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: texts }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`CF AI API 错误 (${resp.status}): ${err.slice(0, 200)}`);
  }

  const data = (await resp.json()) as { result?: { data?: number[][] } };
  const vectors = data.result?.data;
  if (!vectors || vectors.length !== texts.length) {
    throw new Error(`返回的向量数量不匹配: 期望 ${texts.length}, 实际 ${vectors?.length ?? 0}`);
  }

  return vectors;
}

// ── 余弦相似度 ────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── 缓存管理 ──────────────────────────────────────────────────────────────

function loadCachedEmbeddings(chunks: Chunk[]): number[][] | null {
  if (!existsSync(CACHE_FILE)) return null;

  const cached: CachedEmbeddings = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
  const currentTexts = chunks.map(c => c.text);

  // 校验缓存是否与当前 chunks 匹配（文本完全一致才算命中）
  if (cached.chunks.length !== currentTexts.length) return null;
  for (let i = 0; i < cached.chunks.length; i++) {
    if (cached.chunks[i] !== currentTexts[i]) return null;
  }

  console.error(`  缓存命中: ${CACHE_FILE}`);
  return cached.vectors;
}

function saveCachedEmbeddings(chunks: Chunk[], vectors: number[][]): void {
  const cache: CachedEmbeddings = {
    chunks: chunks.map(c => c.text),
    vectors,
  };
  writeFileSync(CACHE_FILE, JSON.stringify(cache));
  console.error(`  缓存已保存: ${CACHE_FILE}`);
}

// ── 召回结果格式化 ───────────────────────────────────────────────────────

function formatResult(chunk: Chunk, score: number): string {
  const pct = (score * 100).toFixed(1);
  const preview = chunk.text
    .replace(/\s+/g, ' ')   // 合并空白
    .slice(0, 300);
  const source = chunk.source_doc + (chunk.section_title !== chunk.source_doc.replace(/\.(pdf|txt)$/i, '')
    ? ` · ${chunk.section_title}`
    : '');

  return `  [${pct}%] ${source}\n  ${preview}\n`;
}

// ── 主流程 ────────────────────────────────────────────────────────────────

async function search(chunks: Chunk[], chunkVecs: number[][], query: string): Promise<void> {
  console.log(`\n🔍 查询: "${query}"`);
  console.log(`   计算查询 embedding…`);

  const queryVec = (await embedBatch([query]))[0];

  // 计算相似度并排序
  const scored = chunks
    .map((chunk, i) => ({ chunk, score: cosineSimilarity(queryVec, chunkVecs[i]) }))
    .sort((a, b) => b.score - a.score);

  // 展示 Top-K
  const TOP_K = 5;
  console.log(`\n📊 Top ${Math.min(TOP_K, scored.length)} 结果：`);
  for (const { chunk, score } of scored.slice(0, TOP_K)) {
    if (score < 0.1) break; // 太低的跳过
    console.log(formatResult(chunk, score));
  }

  // 展示得分分布（诊断信息）
  if (scored.length > 1) {
    const scores = scored.map(s => s.score);
    const gap = scored.length >= 2 ? scored[0].score - scored[1].score : 0;
    console.log(`  得分范围: ${(scores[scores.length - 1] * 100).toFixed(1)}% ~ ${(scores[0] * 100).toFixed(1)}%`);
    console.log(`  Top1-Top2 差距: ${(gap * 100).toFixed(1)} 个百分点`);
    if (gap < 0.05) {
      console.log('  ⚠️ Top 结果区分度较低，可能需要优化 chunk 粒度');
    }
  }
}

async function main(): Promise<void> {
  // 初始化 Cloudflare 凭据
  const creds = await loadCredentials();
  _CF_TOKEN = creds.token;
  _CF_ACCOUNT_ID = creds.accountId;

  // 加载 chunks
  if (!existsSync(CHUNKS_FILE)) {
    console.error(`❌ 未找到 ${CHUNKS_FILE}`);
    console.error('   请先运行 npm run ingest-knowledge 生成知识库数据');
    process.exit(1);
  }

  const chunks: Chunk[] = JSON.parse(readFileSync(CHUNKS_FILE, 'utf-8'));
  const totalChars = chunks.reduce((s, c) => s + c.text.length, 0);

  console.log(`📚 加载了 ${chunks.length} 个 chunks（共 ${totalChars.toLocaleString()} 字符）`);
  console.log(`   API: ${EMBEDDING_MODEL}`);
  console.log(`   维度: 1024`);
  console.log();

  // 加载或计算 chunk embeddings（带缓存）
  let chunkVecs: number[][] | null = loadCachedEmbeddings(chunks);

  if (!chunkVecs) {
    console.error(`计算 ${chunks.length} 个 chunks 的 embedding…`);
    chunkVecs = [];
    // 分批调用 API（每批最多 10 个）
    const BATCH_SIZE = 3;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE).map(c => c.text);
      process.stdout.write(`  batch ${i / BATCH_SIZE + 1}/${Math.ceil(chunks.length / BATCH_SIZE)}…`);
      const vectors = await embedBatch(batch);
      chunkVecs.push(...vectors);
      console.error(` done`);
    }
    saveCachedEmbeddings(chunks, chunkVecs);
  }

  // 交互式模式
  const args = process.argv[2];
  if (args) {
    await search(chunks, chunkVecs, args);
    return;
  }

  // 交互式循环
  console.log('💬 交互模式已启动。输入查询内容，或输入 /q 退出。\n');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (): void => {
    rl.question('>> ', async (query) => {
      if (query.trim().toLowerCase() === '/q') {
        rl.close();
        return;
      }
      if (query.trim()) {
        try {
          await search(chunks, chunkVecs!, query.trim());
        } catch (e) {
          console.error('\n❌ 检索失败:', e instanceof Error ? e.message : String(e));
        }
      }
      console.log(); // 空行分隔
      ask();
    });
  };

  ask();
}

main().catch(e => {
  console.error('\n❌ 错误:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
