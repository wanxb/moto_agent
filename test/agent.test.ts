import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { runAgentLoop } from '../src/agent';
import { registry } from '../src/tools';
import { initDB, clearDB } from './utils';
import type { Message, LLMResponse, ToolDefinition } from '../src/types';
import type { ILLMProvider } from '../src/ports';

// ── Mock provider ─────────────────────────────────────────────────────────────

function createMockProvider(): { provider: ILLMProvider; mock: ReturnType<typeof vi.fn> } {
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

function llmToolCall(name: string, id: string, input: Record<string, unknown>): LLMResponse {
  return {
    textContent: null,
    toolCalls: [{ id, name, input }],
    assistantMessage: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(input) } }],
    },
  };
}

const tools: ToolDefinition[] = registry.toOpenAI();

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

// ── Tests ────────────────────────────────────────────────────────────────────

describe('runAgentLoop — no tool calls', () => {
  it('returns model text directly when no tools needed', async () => {
    const { provider, mock } = createMockProvider();
    mock.mockResolvedValueOnce(llmText('你好！'));

    const messages: Message[] = [{ role: 'user', content: '你好' }];
    const reply = await runAgentLoop(messages, provider, [], registry, env.DB);

    expect(reply).toBe('你好！');
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('appends assistant message to messages array', async () => {
    const { provider, mock } = createMockProvider();
    mock.mockResolvedValueOnce(llmText('回复内容'));
    const messages: Message[] = [{ role: 'user', content: '测试' }];

    await runAgentLoop(messages, provider, [], registry, env.DB);

    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe('assistant');
  });
});

describe('runAgentLoop — single tool call', () => {
  it('calls get_last_record and returns formatted result', async () => {
    const { provider, mock } = createMockProvider();
    mock.mockResolvedValueOnce(llmToolCall('get_last_record', 'c1', {}));
    mock.mockResolvedValueOnce(llmText('暂无加油记录。'));

    const messages: Message[] = [{ role: 'user', content: '上次加油是什么时候' }];
    const reply = await runAgentLoop(messages, provider, tools, registry, env.DB);

    expect(reply).toBe('暂无加油记录。');
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('passes tool result back to LLM in second call', async () => {
    const { provider, mock } = createMockProvider();
    mock.mockResolvedValueOnce(llmToolCall('get_last_record', 'c1', {}));
    mock.mockResolvedValueOnce(llmText('好的'));

    const messages: Message[] = [{ role: 'user', content: '查询' }];
    await runAgentLoop(messages, provider, tools, registry, env.DB);

    const secondCallMessages = mock.mock.calls[1][0] as Message[];
    const toolResultMsg = secondCallMessages.find(m => m.role === 'tool');
    expect(toolResultMsg).toBeDefined();
    expect((toolResultMsg as { content: string }).content).toContain('暂无');
  });
});

describe('runAgentLoop — log_fuel tool call', () => {
  it('records fuel and LLM confirms', async () => {
    const { provider, mock } = createMockProvider();
    mock.mockResolvedValueOnce(llmToolCall('log_fuel', 'c2', {
      date: '2026-06-23', odometer: 12000, liters: 10, price_total: 98,
    }));
    mock.mockResolvedValueOnce(llmText('已记录加油信息！'));

    const messages: Message[] = [{ role: 'user', content: '加了10升，98块，里程12000' }];
    const reply = await runAgentLoop(messages, provider, tools, registry, env.DB);

    expect(reply).toBe('已记录加油信息！');

    const secondCallMessages = mock.mock.calls[1][0] as Message[];
    const toolResult = secondCallMessages.find(m => m.role === 'tool');
    expect((toolResult as { content: string }).content).toContain('✅ 已记录');
  });
});

describe('runAgentLoop — error handling', () => {
  it('returns error message when tool throws', async () => {
    const { provider, mock } = createMockProvider();
    mock.mockResolvedValueOnce(llmToolCall('broken_tool', 'c3', {}));
    mock.mockResolvedValueOnce(llmText('工具出错了'));

    const messages: Message[] = [{ role: 'user', content: '测试错误' }];
    const reply = await runAgentLoop(messages, provider, tools, registry, env.DB);

    expect(reply).toBe('工具出错了');

    const secondCallMessages = mock.mock.calls[1][0] as Message[];
    const toolResult = secondCallMessages.find(m => m.role === 'tool');
    expect((toolResult as { content: string }).content).toContain('未知工具');
  });

  it('returns 处理超时 if LLM keeps calling tools beyond MAX_ROUNDS', async () => {
    const { provider, mock } = createMockProvider();
    mock.mockResolvedValue(llmToolCall('get_last_record', 'c4', {}));

    const messages: Message[] = [{ role: 'user', content: '循环测试' }];
    const reply = await runAgentLoop(messages, provider, tools, registry, env.DB);

    expect(reply).toBe('处理超时，请重试。');
  });
});

describe('runAgentLoop — multi-turn context', () => {
  it('system prompt is always first in working messages', async () => {
    const { provider, mock } = createMockProvider();
    mock.mockResolvedValueOnce(llmText('好'));

    const messages: Message[] = [
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '回复一' },
      { role: 'user', content: '第二条' },
    ];
    await runAgentLoop(messages, provider, [], registry, env.DB);

    const firstCallMessages = mock.mock.calls[0][0] as Message[];
    expect(firstCallMessages[0].role).toBe('system');
    expect((firstCallMessages[0] as { role: 'system'; content: string }).content).toContain('摩托车');
  });
});
