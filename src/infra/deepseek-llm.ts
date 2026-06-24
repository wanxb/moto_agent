// DeepSeek V3 LLM 提供商（OpenAI 兼容格式）。

import { callDeepSeek } from '../llm';
import type { ILLMProvider } from '../ports';
import type { Message, LLMResponse, ToolDefinition } from '../types';

export class DeepSeekLLM implements ILLMProvider {
  constructor(private apiKey: string) {}

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    return callDeepSeek(messages, tools, this.apiKey);
  }
}
