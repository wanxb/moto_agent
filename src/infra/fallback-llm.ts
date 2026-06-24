// 主备双模型组合：首优先尝试 primary，3 次重试后切 secondary（组合模式）。

import { isRetryable, sleep } from '../llm';
import type { ILLMProvider } from '../ports';
import type { Message, LLMResponse, ToolDefinition } from '../types';

export class FallbackLLM implements ILLMProvider {
  constructor(
    private primary: ILLMProvider,
    private secondary: ILLMProvider,
    private maxRetries = 3,
  ) {}

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await this.primary.chat(messages, tools);
      } catch (e) {
        if (!isRetryable(e)) throw e;          // 4xx — 不重试不 fallback
        if (attempt === this.maxRetries - 1) break;
        await sleep(500 * Math.pow(2, attempt));
      }
    }
    console.log('[llm] primary unavailable, falling back to secondary');
    return this.secondary.chat(messages, tools);
  }
}
