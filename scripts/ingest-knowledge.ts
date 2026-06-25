/**
 * 知识库离线入库脚本（spec 015）。
 * 扫描 /knowledge/ 目录，将 PDF / TXT 解析为 chunks → 保存 JSON + SQL。
 *
 * 支持两种格式：
 *   .txt  — 纯文本（推荐）
 *   .pdf  — 文字版 PDF 自动提取；扫描件自动 OCR（需系统安装 poppler）
 *           安装：winget install "oschwartz10612.Poppler"
 *
 * 用法：
 *   npm run ingest-knowledge
 *
 * 输出：
 *   knowledge/chunks.json   — 所有 chunk 的 JSON
 *   knowledge/import.sql    — 可直接灌入 D1 的 SQL
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, mkdtempSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// ── OCR 后处理 ─────────────────────────────────────────────────────────────

/**
 * 清理 OCR 文本中的常见噪声：
 * 1. 去掉中文之间的多余空格（"车 架 号" → "车架号"）
 * 2. 过滤纯噪声行（乱码比例过高的行）
 * 3. 合并被割裂的中文短行
 */
function cleanOcrText(raw: string): string {
  // 步骤 1：去掉中文之间的空格（保留中文与英文/数字之间的空格）
  // 两个 CJK 字之间的空格去掉
  let text = raw.replace(/([一-鿿㐀-䶿])\s+([一-鿿㐀-䶿])/g, '$1$2');
  // 重复执行（因为 OCR 可能多个连续空格： "车  架  号"）
  text = text.replace(/([一-鿿㐀-䶿])\s+([一-鿿㐀-䶿])/g, '$1$2');
  // CJK 与中文标点之间的空格也去掉
  text = text.replace(/([一-鿿㐀-䶿　-〿＀-￯])\s+(?=[一-鿿㐀-䶿　-〿＀-￯])/g, '$1');

  // 步骤 2：按行清洗
  const lines = text.split('\n');
  const cleaned: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行保留（用作分段标记）
    if (!trimmed) {
      cleaned.push('');
      continue;
    }

    // 计算噪声比例：非中文/英文/数字/常见标点的字符占比
    const noiseChars = trimmed.replace(/[一-鿿㐀-䶿a-zA-Z0-9　-〿＀-￯\s.,;:!?()（）【】《》、。，；：！？""''%/\-+@#*\[\]]/g, '');
    const noiseRatio = trimmed.length > 0 ? noiseChars.length / trimmed.length : 0;

    // 如果 > 50% 是噪声且行不短，过滤掉
    if (noiseRatio > 0.5 && trimmed.length > 5) continue;

    // 纯符号/数字行（无中文）且长度 < 10，可能只是页码或图号
    const hasChinese = /[一-鿿]/.test(trimmed);
    if (!hasChinese && trimmed.length < 10) continue;

    cleaned.push(trimmed);
  }

  // 步骤 3：合并连续短行（OCR 常把一句话断成多行）
  const merged: string[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (!cleaned[i]) {
      // 空行：段落分隔符，保留
      merged.push(cleaned[i]);
      continue;
    }

    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev !== '' && cleaned[i].length < 40 && prev.length < 60) {
      // 两行都短 → 合并
      merged[merged.length - 1] = prev + ' ' + cleaned[i];
    } else {
      merged.push(cleaned[i]);
    }
  }

  return merged.join('\n');
}

// ── 文本分块 ─────────────────────────────────────────────────────────────────

interface Chunk {
  text: string;
  source_doc: string;
  section_title: string;
  chunk_index: number;
}

/** 技术参数类文档的关键段落标题，遇这些词优先切段 */
const SECTION_KEYWORDS = [
  '技术参数', '保养规范', '维修数据', '安全注意事项',
  '零件位置', '加注润滑', '故障排除', '主要组件',
  '轮胎', '制动器', '制动系统', '发动机', '悬挂系统',
  '电气系统', '车架', '外观', '操作',
  '蓄电池', '火花塞', '机油', '齿轮油',
  '保险丝', '灯泡', '指示灯',
];

/** 将 OCR 后的文本分割为语义段落，再合并成 300~800 字符的 chunks（更小粒度） */
function splitIntoChunks(text: string, maxLen = 800, minLen = 200): string[] {
  // 先用空行切段落
  let parts = text.split(/\n\n+/).filter(p => p.trim());

  // 再对每个段落按关键词二次切割，长段暴力切
  const segments: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.length > maxLen) {
      // 先试关键词切分
      const byKeywords = splitByKeywords(trimmed);
      if (byKeywords.length > 1) {
        segments.push(...byKeywords);
      } else {
        // 关键词没切动 → 暴力切
        segments.push(...forceSplitLongSegment(trimmed, maxLen));
      }
    } else {
      segments.push(trimmed);
    }
  }

  // 合并太短的段
  const result: string[] = [];
  let buffer = '';

  for (const seg of segments) {
    if (!seg) continue;

    if (buffer.length + seg.length + 2 > maxLen && buffer.length >= minLen) {
      result.push(buffer.trim());
      buffer = seg;
    } else if (buffer.length + seg.length + 2 > maxLen * 1.5 && buffer.length >= minLen) {
      if (buffer.length >= minLen) result.push(buffer.trim());
      buffer = seg;
    } else {
      buffer += (buffer ? '\n\n' : '') + seg;
    }
  }

  if (buffer.trim().length >= minLen) {
    result.push(buffer.trim());
  } else if (result.length > 0 && buffer.trim().length > 0) {
    const last = result.pop()!;
    result.push(last + '\n\n' + buffer.trim());
  } else if (buffer.trim().length > 0) {
    result.push(buffer.trim());
  }

  return result;
}

/** 按关键技术词分割长文本段（OCR 文本缺少换行结构，支持行内匹配） */
function splitByKeywords(text: string): string[] {
  // 在句号/分号/换行后找关键词
  const sepPattern = new RegExp(
    `(?:[。；!！?？\\n]\\s*|^)(?:@\\s*|\\d+[.、]\\s*)?(${SECTION_KEYWORDS.join('|')})`,
    'g'
  );

  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sepPattern.exec(text)) !== null) {
    const preceding = text.slice(lastIndex, match.index + (match[0].startsWith(match[1]!) ? 0 : match[0].indexOf(match[1]!))).trim();
    if (preceding.length > 30) parts.push(preceding);
    lastIndex = match.index + match[0].indexOf(match[1]!) + (match[1]?.length ?? 0);
  }

  // 最后一段
  const trailing = text.slice(lastIndex).trim();
  if (trailing.length > 30) parts.push(trailing);

  if (parts.length <= 1) return [text.trim()];

  // 合并太短的段
  const merged: string[] = [];
  for (const part of parts) {
    if (part.length < 60 && merged.length > 0) {
      merged[merged.length - 1] += '\n' + part;
    } else {
      merged.push(part);
    }
  }
  return merged;
}

/** 如果关键词分割没效果，用句号/分号/换行暴力切长段 */
function forceSplitLongSegment(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const splits = text.split(/(?<=[。；!！?？\n])/);
  const chunks: string[] = [];
  let buffer = '';

  for (const s of splits) {
    if (!s.trim()) continue;
    if (buffer.length + s.length > maxLen && buffer.length >= 100) {
      chunks.push(buffer.trim());
      buffer = s;
    } else {
      buffer += s;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());

  // 一段都没切开 → 暴力等分
  if (chunks.length <= 1 && chunks[0] && chunks[0].length > maxLen * 1.3) {
    const half = Math.ceil(chunks[0].length / 2);
    return [chunks[0].slice(0, half).trim(), chunks[0].slice(half).trim()];
  }

  return chunks;
}

/** 文档 → chunks：清洗 → 分块 → 附文件信息 */
function docToChunks(text: string, fileName: string): Chunk[] {
  const cleaned = cleanOcrText(text);
  const baseTitle = fileName.replace(/\.(pdf|txt)$/i, '');
  return splitIntoChunks(cleaned).map((t, i) => ({
    text: t,
    source_doc: fileName,
    section_title: baseTitle,
    chunk_index: i,
  }));
}

// ── 跨文档去重 ──────────────────────────────────────────────────────────────

/** 用字符 4-gram Jaccard 相似度检测两个文本是否近义重复（仅对比中文部分，抗 OCR 噪声） */
function textSimilarity(a: string, b: string): number {
  // 只提取中文字符，忽略 OCR 噪声和字母数字
  const cjkOnly = (s: string) => (s.match(/[一-鿿㐀-䶿]/g) || []).join('').slice(0, 3000);
  const na = cjkOnly(a);
  const nb = cjkOnly(b);

  if (na.length < 20 || nb.length < 20) return 0; // 太短不比较

  const gramsA = new Set<string>();
  const gramsB = new Set<string>();

  for (let i = 0; i < na.length - 3; i++) gramsA.add(na.slice(i, i + 4));
  for (let i = 0; i < nb.length - 3; i++) gramsB.add(nb.slice(i, i + 4));

  if (gramsA.size === 0 && gramsB.size === 0) return 1;
  if (gramsA.size === 0 || gramsB.size === 0) return 0;

  let intersection = 0;
  for (const g of gramsA) {
    if (gramsB.has(g)) intersection++;
  }

  return intersection / (gramsA.size + gramsB.size - intersection);
}

/** 衡量 chunk 质量得分（越高越好），用于去重时保留更好的 */
function chunkQuality(text: string): number {
  const norm = text.replace(/\s+/g, '');
  // 中文比例高 + 总字符多 = 质量好
  const cjkCount = (norm.match(/[一-鿿㐀-䶿]/g) || []).length;
  const cjkRatio = norm.length > 0 ? cjkCount / norm.length : 0;
  // 含数字和技术参数加分
  const digits = (norm.match(/\d+/g) || []).length;
  // 噪声字符（乱码中常见的非中英文字符）占比低加分
  const noise = (norm.replace(/[一-鿿a-zA-Z0-9]/g, '').length);
  const noisePenalty = norm.length > 0 ? noise / norm.length : 0;

  return cjkRatio * 10 + Math.min(digits, 20) * 0.5 - noisePenalty * 5 + norm.length * 0.01;
}

/** 对跨文档的 chunks 做近似去重，保留质量更高的那条 */
function dedupChunks(chunks: Chunk[], threshold = 0.35): { chunks: Chunk[]; removed: number } {
  const kept: Chunk[] = [];
  let removed = 0;

  for (const chunk of chunks) {
    let isDuplicate = false;
    for (let i = 0; i < kept.length; i++) {
      const existing = kept[i];
      const sim = textSimilarity(chunk.text, existing.text);
      if (sim >= threshold) {
        // 发现近似重复，保留质量更好的
        const existingScore = chunkQuality(existing.text);
        const newScore = chunkQuality(chunk.text);
        if (newScore > existingScore) {
          // 新的更好，替换
          kept[i] = chunk;
        }
        isDuplicate = true;
        removed++;
        break;
      }
    }
    if (!isDuplicate) {
      kept.push(chunk);
    }
  }

  return { chunks: kept, removed };
}

// ── PDF 文字提取 + OCR 兜底 ────────────────────────────────────────────────

/** 用 pdf-parse 尝试提取文字（仅对文字版 PDF 有效） */
async function extractTextViaPdfParse(buf: Buffer): Promise<string> {
  const mod = await import('pdf-parse');
  const parser = new mod.PDFParse({ data: buf });
  const result = await parser.getText();
  return result.text ?? '';
}

/** 查找 pdftoppm 可执行文件路径 */
function findPdftoppm(): string {
  // 常见安装路径
  const candidates = [
    'pdftoppm', // PATH 内
    '/mingw64/bin/pdftoppm',
    'C:/ProgramData/poppler/bin/pdftoppm.exe',
    'C:/Users/Administrator/AppData/Local/Microsoft/WinGet/Packages/oschwartz10612.Poppler_Microsoft.Winget.Source_8wekyb3d8bbwe/poppler-25.07.0/Library/bin/pdftoppm.exe',
  ];
  for (const c of candidates) {
    try {
      execSync(`"${c}" -v 2>&1`, { stdio: 'ignore' });
      return c;
    } catch {}
  }
  throw new Error(
    '找不到 pdftoppm。请安装 poppler：\n' +
    '  winget install "oschwartz10612.Poppler"\n' +
    '或通过系统包管理器安装（apt install poppler-utils / brew install poppler）'
  );
}

/**
 * 用 pdftoppm（poppler）渲染 PDF 页面为 PNG，再用 tesseract.js OCR。
 * 避开了 pdfjs-dist + node-canvas 在 Node 下的兼容性问题。
 */
async function extractTextViaOcr(buf: Uint8Array): Promise<string> {
  const pdftoppm = findPdftoppm();

  // pdftoppm 需要文件路径，不能直接 pipe buffer
  const workDir = mkdtempSync(join(tmpdir(), 'pdfocr_'));
  const pdfPath = join(workDir, 'input.pdf');
  writeFileSync(pdfPath, buf);

  try {
    // 先获取页数
    const pdfinfoPath = pdftoppm.replace('pdftoppm', 'pdfinfo').replace('pdftoppm.exe', 'pdfinfo.exe');
    let pageCount = 1;
    try {
      const info = execSync(`"${pdfinfoPath}" "${pdfPath}"`, { encoding: 'utf-8' });
      const m = info.match(/^Pages:\s+(\d+)/im);
      if (m) pageCount = parseInt(m[1], 10);
    } catch {
      // pdfinfo 不可用时默认为 1
    }

    console.error(`[ocr] 共 ${pageCount} 页，渲染中…`);

    // 用 pdftoppm 渲染所有页面为 PNG（200 DPI 足够 OCR）
    const prefix = join(workDir, 'page');
    execSync(`"${pdftoppm}" -png -r 200 "${pdfPath}" "${prefix}"`, {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 120_000,
    });

    console.error(`[ocr] 渲染完成，启动 OCR…`);

    const { default: Tesseract } = await import('tesseract.js');
    let fullText = '';

    for (let i = 1; i <= pageCount; i++) {
      const pngFile = join(workDir, `page-${i}.png`);
      if (!existsSync(pngFile)) {
        console.error(`[ocr] 页面 ${i} 渲染产物不存在，跳过`);
        continue;
      }

      const imgSize = (readFileSync(pngFile).length / 1024 / 1024).toFixed(1);
      console.error(`[ocr] OCR 第 ${i}/${pageCount} 页 (${imgSize}MB)…`);

      const worker = await Tesseract.createWorker('chi_sim+eng', 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status === 'recognizing text') {
            process.stdout.write(`\r  OCR 第 ${i}/${pageCount} 页: ${(m.progress * 100).toFixed(0)}%`);
          }
        },
      });
      const { data } = await worker.recognize(pngFile);
      await worker.terminate();

      console.log();
      fullText += data.text + '\n\n';
    }

    console.error(`[ocr] 完成，共 ${fullText.trim().length} 字符`);
    return fullText.trim();
  } finally {
    // 清理临时文件
    try { rmSync(workDir, { recursive: true }); } catch {}
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const knowledgeDir = resolve(process.env.INGEST_DIR || join(process.cwd(), 'knowledge'));
  if (!existsSync(knowledgeDir)) {
    console.error(`知识库目录不存在：${knowledgeDir}`);
    console.error(`请创建 ${knowledgeDir} 目录并放入 PDF / TXT 文件，或设置 INGEST_DIR 环境变量。`);
    process.exit(1);
  }

  const files = readdirSync(knowledgeDir).filter(f => f.endsWith('.pdf') || f.endsWith('.txt'));
  if (!files.length) {
    console.error(`${knowledgeDir} 中没有 PDF 或 TXT 文件`);
    process.exit(1);
  }
  console.log(`找到 ${files.length} 个文件：${files.join(', ')}`);

  const allChunks: Chunk[] = [];

  for (const file of files) {
    const filePath = join(knowledgeDir, file);
    const buf = readFileSync(filePath);
    let text: string;

    if (file.endsWith('.txt')) {
      text = buf.toString('utf-8');
      console.log(`\n📄 ${file}: TXT 文件，${text.length} 字符`);
    } else {
      // PDF → 先尝试文字提取
      console.log(`\n📄 ${file}: 尝试提取文字…`);
      text = await extractTextViaPdfParse(buf);

      if (text.length >= 50) {
        console.log(`   ✅ 文字版 PDF，提取到 ${text.length} 字符`);
      } else {
        console.log(`   ⚠️ 仅提取到 ${text.length} 字符，启动 OCR…`);
        text = await extractTextViaOcr(new Uint8Array(buf));
        console.log(`   ✅ OCR 完成，提取到 ${text.length} 字符`);
      }
    }

    const chunks = docToChunks(text, file);
    allChunks.push(...chunks);
    console.log(`   → ${chunks.length} 个 chunks`);
  }

  console.log(`\n共 ${allChunks.length} 个 chunks`);

  // ── 跨文档去重 ──────────────────────────────────────────────────────────
  const { chunks: deduped, removed } = dedupChunks(allChunks);
  if (removed > 0) {
    console.log(`🔁 去重：移除 ${removed} 个近似重复 chunk（保留 ${deduped.length} 个）`);
  }

  // ── 保存 JSON（含 _id，与 Vectorize 元数据和 SQL 对齐） ────────────────
  const jsonPath = join(knowledgeDir, 'chunks.json');
  const jsonOutput = deduped.map((chunk, idx) => ({ _id: idx + 1, ...chunk }));
  writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2));
  console.log(`\n✅ JSON 已保存: ${jsonPath}`);

  // ── 导出 SQL（用显式 ID，与 Vectorize 元数据对齐） ──────────────────────────
  const sqlPath = join(knowledgeDir, 'import.sql');
  const sqlLines: string[] = [];
  deduped.forEach((chunk, idx) => {
    const id = idx + 1; // 从 1 开始
    const escaped = chunk.text.replace(/'/g, "''");
    const src = chunk.source_doc.replace(/'/g, "''");
    const sec = chunk.section_title.replace(/'/g, "''");
    sqlLines.push(
      `INSERT INTO knowledge_chunks (id, chunk_text, source_doc, section_title, chunk_index) VALUES (${id}, '${escaped}', '${src}', '${sec}', ${chunk.chunk_index});`
    );
  });
  // 分批写入（D1 单条限制）
  const batchSize = 100;
  for (let i = 0; i < sqlLines.length; i += batchSize) {
    const batchPath = i === 0 ? sqlPath : sqlPath.replace('.sql', `_${i}.sql`);
    writeFileSync(batchPath, sqlLines.slice(i, i + batchSize).join('\n'));
    if (i > 0) break; // 只拆第一份 batch
  }
  writeFileSync(sqlPath, sqlLines.slice(0, batchSize).join('\n'));
  if (sqlLines.length > batchSize) {
    console.log(`   (前 ${batchSize} 条已导出; 共 ${sqlLines.length} 条)`);
    const remainingPath = sqlPath.replace('.sql', `_批量_${batchSize}_${sqlLines.length}.sql`);
    writeFileSync(remainingPath, sqlLines.join('\n'));
    console.log(`   全部 SQL 已保存: ${remainingPath}`);
  } else {
    console.log(`✅ SQL 已导出: ${sqlPath}（共 ${sqlLines.length} 条）`);
  }

  console.log(`\n下一步：`);
  console.log(`  npx wrangler d1 execute moto-agent-db --file ${sqlPath}`);
}

process.on('unhandledRejection', (reason) => {
  console.error('\n[unhandled]', reason instanceof Error ? reason.message : String(reason));
});

main().catch(e => {
  console.error('\n❌ 入库失败：', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
