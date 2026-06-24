/**
 * LLM 解析评测（spec 006-C）。离线、opt-in，不进 CI。
 * 对 test/eval/cases.json 逐条用真实模型校验「自然语言 → 正确工具 + 关键参数」。
 *
 * 用法：
 *   npm run eval                # 默认每条跑 3 次（多采样区分系统性失败 vs 随机抖动）
 *   EVAL_RUNS=5 npm run eval    # 自定义每条采样次数
 * 需要环境变量（从 .dev.vars 或 shell 取）：
 *   DEEPSEEK_API_KEY            # 主模型
 *   ANTHROPIC_API_KEY          # 可选，DeepSeek 不可用时 fallback
 *
 * 真实模型有随机性：单次跑会把噪声当失败。多采样后按「每条命中率」判断：
 *   ✅ 全中 · ⚠️ 部分中（抖动） · ❌ 全错（系统性，需修）
 * 退出码：总命中率 < THRESHOLD 时为 1。
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { callLLM } from '../src/llm-transport';
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
  const runs = Math.max(1, Number(process.env.EVAL_RUNS ?? 3));

  // 单次判定：返回 null 表示命中，否则返回失败原因（含实际选了哪个工具）
  async function once(c: Case): Promise<string | null> {
    const messages: Message[] = [{ role: 'system', content: system }, { role: 'user', content: c.input }];
    try {
      const resp = await callLLM(messages, TOOLS, deepseekKey, anthropicKey);
      const call = resp.toolCalls?.[0];
      if (!call) return '未调用工具';
      if (call.name !== c.expectTool) return call.name;
      const argErr = c.expectArgs ? argMatches(c.expectArgs, call.input) : null;
      return argErr ? `参数:${argErr}` : null;
    } catch (e) {
      return `异常:${e instanceof Error ? e.message : String(e)}`;
    }
  }

  let totalPass = 0;
  const systematic: string[] = [];
  const flaky: string[] = [];
  console.log(`每条采样 ${runs} 次…\n`);

  for (const c of cases) {
    let hit = 0;
    const misses: string[] = [];
    for (let i = 0; i < runs; i++) {
      const err = await once(c);
      if (err === null) hit++; else misses.push(err);
    }
    totalPass += hit;
    const mark = hit === runs ? '✅' : hit === 0 ? '❌' : '⚠️';
    const detail = misses.length ? `  ← ${[...new Set(misses)].join(', ')}` : '';
    console.log(`${mark} ${hit}/${runs}  "${c.input}" → ${c.expectTool}${detail}`);
    if (hit === 0) systematic.push(`${c.input} → 期望 ${c.expectTool}，实际 ${[...new Set(misses)].join('/')}`);
    else if (hit < runs) flaky.push(`${c.input}（${hit}/${runs}）`);
  }

  const rate = totalPass / (cases.length * runs);
  console.log(`\n总命中率 ${totalPass}/${cases.length * runs} = ${(rate * 100).toFixed(1)}%（阈值 ${THRESHOLD * 100}%）`);
  if (systematic.length) {
    console.log(`\n❌ 系统性失败（每次都错，需修）：`);
    systematic.forEach(f => console.log('  ' + f));
  }
  if (flaky.length) {
    console.log(`\n⚠️ 抖动（偶发，多为模型随机性）：`);
    flaky.forEach(f => console.log('  ' + f));
  }
  process.exit(rate >= THRESHOLD ? 0 : 1);
}

main();
