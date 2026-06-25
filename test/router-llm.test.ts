import { describe, it, expect, vi } from 'vitest';
import { RouterLLM } from '../src/router/router-llm';
import type { ILLMProvider } from '../src/ports';
import type { LLMResponse, Message, ToolDefinition } from '../src/types';

const NO_TOOLS: ToolDefinition[] = [];

const u = (c: string): Message[] => [{ role: 'user', content: c }];

function mockProvider(name: string): { provider: ILLMProvider; mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn();
  const provider: ILLMProvider = { chat: mock };
  return { provider, mock };
}

function llmText(text: string): LLMResponse {
  return {
    textContent: text,
    toolCalls: null,
    assistantMessage: { role: 'assistant', content: text },
  };
}

describe('RouterLLM', () => {
  it('simple 消息 → 调用 simple provider', async () => {
    const { provider: simple, mock: simpleMock } = mockProvider('simple');
    const { provider: complex, mock: complexMock } = mockProvider('complex');
    const router = new RouterLLM(simple, complex);

    simpleMock.mockResolvedValueOnce(llmText('你好！'));

    const result = await router.chat(u('你好'), NO_TOOLS);

    expect(result.textContent).toBe('你好！');
    expect(simpleMock).toHaveBeenCalledTimes(1);
    expect(complexMock).not.toHaveBeenCalled();
  });

  it('complex 消息 → 调用 complex provider', async () => {
    const { provider: simple, mock: simpleMock } = mockProvider('simple');
    const { provider: complex, mock: complexMock } = mockProvider('complex');
    const router = new RouterLLM(simple, complex);

    complexMock.mockResolvedValueOnce(llmText('故障排查结果'));

    const result = await router.chat(u('发动机异响怎么办'), NO_TOOLS);

    expect(result.textContent).toBe('故障排查结果');
    expect(complexMock).toHaveBeenCalledTimes(1);
    expect(simpleMock).not.toHaveBeenCalled();
  });

  it('simple provider 失败 → 升级 complex', async () => {
    const { provider: simple, mock: simpleMock } = mockProvider('simple');
    const { provider: complex, mock: complexMock } = mockProvider('complex');
    const router = new RouterLLM(simple, complex);

    simpleMock.mockRejectedValueOnce(new Error('Rate limit'));
    complexMock.mockResolvedValueOnce(llmText('备用回复'));

    const result = await router.chat(u('你好'), NO_TOOLS);

    expect(result.textContent).toBe('备用回复');
    expect(simpleMock).toHaveBeenCalledTimes(1);
    expect(complexMock).toHaveBeenCalledTimes(1);
  });

  it('simple provider 失败且 complex 也失败 → 异常冒泡', async () => {
    const { provider: simple, mock: simpleMock } = mockProvider('simple');
    const { provider: complex, mock: complexMock } = mockProvider('complex');
    const router = new RouterLLM(simple, complex);

    simpleMock.mockRejectedValueOnce(new Error('simple 崩了'));
    complexMock.mockRejectedValueOnce(new Error('complex 也崩了'));

    await expect(router.chat(u('你好'), NO_TOOLS)).rejects.toThrow('complex 也崩了');
  });

  it('complex provider 失败 → 直接抛（不降级到 simple）', async () => {
    const { provider: simple, mock: simpleMock } = mockProvider('simple');
    const { provider: complex, mock: complexMock } = mockProvider('complex');
    const router = new RouterLLM(simple, complex);

    complexMock.mockRejectedValueOnce(new Error('complex 错误'));

    await expect(router.chat(u('发动机异响'), NO_TOOLS)).rejects.toThrow('complex 错误');
    expect(simpleMock).not.toHaveBeenCalled();
  });
});
