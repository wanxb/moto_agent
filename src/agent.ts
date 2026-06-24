import { Message, Env, type ToolDefinition } from './types';
import { MAX_ROUNDS } from './config';
import { TOOLS, registry } from './tools';
import { callLLM } from './llm-transport';
import type { ILLMProvider } from './ports';
import type { ToolRegistry } from './tools/interface';

import { buildSystemPrompt } from './prompts';

export { buildSystemPrompt };

/**
 * Agent Loop（新签名，R2）：LLM 与工具注册器由外部注入。
 * 兼容旧的 agentLoop(messages, env) —— 后者构造 ILLMProvider 后委托到这里。
 */
export async function runAgentLoop(
  messages: Message[],
  llm: ILLMProvider,
  tools: ToolDefinition[],
  registry: ToolRegistry,
  db: D1Database,
): Promise<string> {
  const systemMsg: Message = { role: 'system', content: buildSystemPrompt() };
  const working: Message[] = [systemMsg, ...messages];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await llm.chat(working, tools);

    working.push(response.assistantMessage);
    messages.push(response.assistantMessage);

    if (!response.toolCalls?.length) {
      return response.textContent ?? '（无回复）';
    }

    for (const tc of response.toolCalls) {
      let result: string;
      try {
        result = await registry.dispatch(tc.name, tc.input, db);
        console.log(`[tool] ${tc.name} →`, result.slice(0, 80));
      } catch (e) {
        result = `工具执行失败：${e instanceof Error ? e.message : String(e)}`;
        console.error(`[tool] ${tc.name} error:`, e);
      }
      const toolMsg: Message = { role: 'tool', tool_call_id: tc.id, content: result };
      working.push(toolMsg);
      messages.push(toolMsg);
    }
  }

  return '处理超时，请重试。';
}

// ── 旧签名（兼容现有调用方 + 测试，不引入 infra 依赖）───────────────────────

export async function agentLoop(messages: Message[], env: Env): Promise<string> {
  const systemMsg: Message = { role: 'system', content: buildSystemPrompt() };
  const working: Message[] = [systemMsg, ...messages];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await callLLM(working, TOOLS, env.DEEPSEEK_API_KEY, env.ANTHROPIC_API_KEY);

    working.push(response.assistantMessage);
    messages.push(response.assistantMessage);

    if (!response.toolCalls?.length) {
      return response.textContent ?? '（无回复）';
    }

    for (const tc of response.toolCalls) {
      let result: string;
      try {
        result = await registry.dispatch(tc.name, tc.input, env.DB);
        console.log(`[tool] ${tc.name} →`, result.slice(0, 80));
      } catch (e) {
        result = `工具执行失败：${e instanceof Error ? e.message : String(e)}`;
        console.error(`[tool] ${tc.name} error:`, e);
      }
      const toolMsg: Message = { role: 'tool', tool_call_id: tc.id, content: result };
      working.push(toolMsg);
      messages.push(toolMsg);
    }
  }

  return '处理超时，请重试。';
}
