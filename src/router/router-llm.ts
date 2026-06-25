// 分层模型路由器：按用户消息复杂度将请求派发到不同模型层。
// 实现 ILLMProvider 接口，对 agent.ts 完全透明。

import type { ILLMProvider } from '../ports';
import type { Message, LLMResponse, ToolDefinition } from '../types';
import { classifyComplexity, type Complexity } from './classifier';

export class RouterLLM implements ILLMProvider {
  constructor(
    private simple: ILLMProvider,
    private complex: ILLMProvider,
  ) {}

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const tier = classifyComplexity(messages);
    const provider = tier === 'simple' ? this.simple : this.complex;

    console.log(`[router] tier=${tier} messages=${messages.length} tools=${tools.length}`);

    try {
      return await provider.chat(messages, tools);
    } catch (e) {
      // simple 层挂了 → 升级到 complex 层重试（跨层自愈）
      if (tier === 'simple') {
        console.log('[router] simple failed, escalating to complex');
        return this.complex.chat(messages, tools);
      }
      throw e;
    }
  }
}
