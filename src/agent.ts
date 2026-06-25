import { Message, type ToolDefinition } from './types';
import { MAX_ROUNDS } from './config';
import { registry } from './tools';
import type { ILLMProvider } from './ports';
import type { ToolRegistry } from './tools/interface';
import type { Lang } from './i18n/types';
import { t } from './i18n';

import { buildSystemPrompt } from './prompts';

export { buildSystemPrompt };

/**
 * Agent Loop：LLM 与工具注册器由外部注入。
 */
export async function runAgentLoop(
  messages: Message[],
  llm: ILLMProvider,
  tools: ToolDefinition[],
  registry: ToolRegistry,
  db: D1Database,
  lang: Lang = 'zh',
): Promise<string> {
  const systemMsg: Message = { role: 'system', content: buildSystemPrompt(lang) };
  const working: Message[] = [systemMsg, ...messages];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await llm.chat(working, tools);

    working.push(response.assistantMessage);
    messages.push(response.assistantMessage);

    if (!response.toolCalls?.length) {
      return response.textContent ?? t('general.no_reply', lang);
    }

    for (const tc of response.toolCalls) {
      let result: string;
      try {
        result = await registry.dispatch(tc.name, tc.input, db, lang);
        console.log(`[tool] ${tc.name} →`, result.slice(0, 80));
      } catch (e) {
        result = t('general.tool_error', lang, e instanceof Error ? e.message : String(e));
        console.error(`[tool] ${tc.name} error:`, e);
      }
      const toolMsg: Message = { role: 'tool', tool_call_id: tc.id, content: result };
      working.push(toolMsg);
      messages.push(toolMsg);
    }
  }

  return t('general.timeout', lang);
}
