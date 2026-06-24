/**
 * LLM 解析评测（spec 006-C）。离线、opt-in，不进 CI。
 * 对 test/eval/cases.json 逐条用真实模型校验「自然语言 → 正确工具 + 关键参数」。
 *
 * 用法：
 *   npm run eval                # 用 DEEPSEEK_API_KEY 跑全部用例
 * 需要环境变量（从 .dev.vars 或 shell 取）：
 *   DEEPSEEK_API_KEY            # 主模型
 *   ANTHROPIC_API_KEY          # 可选，DeepSeek 不可用时 fallback
 *
 * 退出码：通过率 < THRESHOLD 时为 1（便于将来手动当门禁）。
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { callLLM } from '../src/llm';
import { TOOLS } from '../src/tools';
import { buildSystemPrompt } from '../src/agent';
import type { Message } from '../src/types';

const THRESHOLD = 0.95;

interface Case {
  input: string;
  expectTool: string;
  expectArgs?: Record<string, unknown>;
}

// 从 .dev.vars 读 KEY=VALUE（若环境变量未设）
function loadDevVars(): void {
  const p = join(process.cwd(), '.dev.vars');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function argMatches(expect: Record<string, unknown>, got: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(expect)) {
    if (got[k] !== v) return `参数 ${k} 期望 ${JSON.stringify(v)} 实际 ${JSON.stringify(got[k])}`;
  }
  return null;
}

async function main(): Promise<void> {
  loadDevVars();
  const deepseekKey = process.env.DEEPSEEK_API_KEY ?? '';
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!deepseekKey) {
    console.error('缺少 DEEPSEEK_API_KEY（设环境变量或写入 .dev.vars）');
    process.exit(2);
  }

  const cases: Case[] = JSON.parse(readFileSync(join(process.cwd(), 'test/eval/cases.json'), 'utf8'));
  const system = buildSystemPrompt();

  let pass = 0;
  const failures: string[] = [];

  for (const c of cases) {
    const messages: Message[] = [{ role: 'system', content: system }, { role: 'user', content: c.input }];
    let line: string;
    try {
      const resp = await callLLM(messages, TOOLS, deepseekKey, anthropicKey);
      const call = resp.toolCalls?.[0];
      if (!call) {
        line = `❌ "${c.input}" → 未调用工具（期望 ${c.expectTool}）`;
      } else if (call.name !== c.expectTool) {
        line = `❌ "${c.input}" → 工具 ${call.name}（期望 ${c.expectTool}）`;
      } else {
        const argErr = c.expectArgs ? argMatches(c.expectArgs, call.input) : null;
        if (argErr) {
          line = `❌ "${c.input}" → 工具对，但${argErr}`;
        } else {
          line = `✅ "${c.input}" → ${call.name}`;
          pass++;
        }
      }
    } catch (e) {
      line = `❌ "${c.input}" → 调用异常：${e instanceof Error ? e.message : String(e)}`;
    }
    console.log(line);
    if (line.startsWith('❌')) failures.push(line);
  }

  const rate = pass / cases.length;
  console.log(`\n通过率 ${pass}/${cases.length} = ${(rate * 100).toFixed(1)}%（阈值 ${(THRESHOLD * 100)}%）`);
  if (failures.length) {
    console.log('\n失败项：');
    failures.forEach(f => console.log('  ' + f));
  }
  process.exit(rate >= THRESHOLD ? 0 : 1);
}

main();
