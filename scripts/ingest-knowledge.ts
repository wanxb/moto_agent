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

// ── 文本分块 ─────────────────────────────────────────────────────────────────

interface Chunk {
  text: string;
  source_doc: string;
  section_title: string;
  chunk_index: number;
}

/** 将全文按段落分割，合并成 200~1500 字符的 chunks */
function splitIntoChunks(text: string, maxLen = 1500, minLen = 200): string[] {
  const parts = text.split(/\n\n+/);  // 空行分段
  const result: string[] = [];
  let buffer = '';

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (buffer.length + trimmed.length + 2 > maxLen && buffer.length >= minLen) {
      result.push(buffer.trim());
      buffer = trimmed;
    } else {
      buffer += (buffer ? '\n\n' : '') + trimmed;
    }
  }

  if (buffer.trim().length >= minLen) result.push(buffer.trim());

  // 如果太短（整篇少于 minLen），直接整篇出
  if (result.length === 0 && text.trim().length > 0) {
    result.push(text.trim());
  }

  return result;
}

/** 文档 → chunks：调用 splitIntoChunks 并附上文件信息 */
function docToChunks(text: string, fileName: string): Chunk[] {
  return splitIntoChunks(text).map((t, i) => ({
    text: t,
    source_doc: fileName,
    section_title: fileName.replace(/\.(pdf|txt)$/i, ''),
    chunk_index: i,
  }));
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

  // ── 保存 JSON ──────────────────────────────────────────────────────────
  const jsonPath = join(knowledgeDir, 'chunks.json');
  writeFileSync(jsonPath, JSON.stringify(allChunks, null, 2));
  console.log(`\n✅ JSON 已保存: ${jsonPath}`);

  // ── 导出 SQL ──────────────────────────────────────────────────────────
  const sqlPath = join(knowledgeDir, 'import.sql');
  const sqlLines: string[] = [];
  for (const chunk of allChunks) {
    const escaped = chunk.text.replace(/'/g, "''");
    const src = chunk.source_doc.replace(/'/g, "''");
    const sec = chunk.section_title.replace(/'/g, "''");
    sqlLines.push(
      `INSERT INTO knowledge_chunks (chunk_text, source_doc, section_title, chunk_index) VALUES ('${escaped}', '${src}', '${sec}', ${chunk.chunk_index});`
    );
  }
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
