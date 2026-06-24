// Anthropic Claude LLM 提供商（备用）。

import { callAnthropic } from '../llm-transport';
import type { ILLMProvider } from '../ports';
import type { Message, LLMResponse, ToolDefinition } from '../types';

export class AnthropicLLM implements ILLMProvider {
  constructor(private apiKey: string) {}

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    return callAnthropic(messages, tools, this.apiKey);
  }
}
