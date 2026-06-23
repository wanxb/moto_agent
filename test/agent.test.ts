import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { agentLoop } from '../src/agent';
import { initDB, clearDB, makeEnv } from './utils';
import type { Message, LLMResponse } from '../src/types';

// Mock the entire llm module so agent tests don't make real network calls
vi.mock('../src/llm', () => ({ callLLM: vi.fn() }));
import { callLLM } from '../src/llm';
const mockLLM = callLLM as ReturnType<typeof vi.fn>;

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => {
  await clearDB(env.DB);
  vi.clearAllMocks();
});

// ── Response factories ────────────────────────────────────────────────────────

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('agentLoop — no tool calls', () => {
  it('returns model text directly when no tools needed', async () => {
    mockLLM.mockResolvedValueOnce(llmText('你好！'));

    const messages: Message[] = [{ role: 'user', content: '你好' }];
    const reply = await agentLoop(messages, makeEnv(env.DB, env.SESSION_KV));

    expect(reply).toBe('你好！');
    expect(mockLLM).toHaveBeenCalledTimes(1);
  });

  it('appends assistant message to messages array', async () => {
    mockLLM.mockResolvedValueOnce(llmText('回复内容'));
    const messages: Message[] = [{ role: 'user', content: '测试' }];

    await agentLoop(messages, makeEnv(env.DB, env.SESSION_KV));

    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe('assistant');
  });
});

describe('agentLoop — single tool call', () => {
  it('calls get_last_record and returns formatted result', async () => {
    // Round 1: model calls get_last_record
    mockLLM.mockResolvedValueOnce(llmToolCall('get_last_record', 'c1', {}));
    // Round 2: model returns final text after seeing tool result
    mockLLM.mockResolvedValueOnce(llmText('暂无加油记录。'));

    const messages: Message[] = [{ role: 'user', content: '上次加油是什么时候' }];
    const reply = await agentLoop(messages, makeEnv(env.DB, env.SESSION_KV));

    expect(reply).toBe('暂无加油记录。');
    expect(mockLLM).toHaveBeenCalledTimes(2);
  });

  it('passes tool result back to LLM in second call', async () => {
    mockLLM.mockResolvedValueOnce(llmToolCall('get_last_record', 'c1', {}));
    mockLLM.mockResolvedValueOnce(llmText('好的'));

    const messages: Message[] = [{ role: 'user', content: '查询' }];
    await agentLoop(messages, makeEnv(env.DB, env.SESSION_KV));

    // Second LLM call should include tool result in messages
    const secondCallMessages = mockLLM.mock.calls[1][0] as Message[];
    const toolResultMsg = secondCallMessages.find(m => m.role === 'tool');
    expect(toolResultMsg).toBeDefined();
    expect((toolResultMsg as { content: string }).content).toContain('暂无');
  });
});

describe('agentLoop — log_fuel tool call', () => {
  it('records fuel and LLM confirms', async () => {
    mockLLM.mockResolvedValueOnce(llmToolCall('log_fuel', 'c2', {
      date: '2026-06-23', odometer: 12000, liters: 10, price_total: 98,
    }));
    mockLLM.mockResolvedValueOnce(llmText('已记录加油信息！'));

    const messages: Message[] = [{ role: 'user', content: '加了10升，98块，里程12000' }];
    const reply = await agentLoop(messages, makeEnv(env.DB, env.SESSION_KV));

    expect(reply).toBe('已记录加油信息！');

    // Verify tool result in second call contains success confirmation
    const secondCallMessages = mockLLM.mock.calls[1][0] as Message[];
    const toolResult = secondCallMessages.find(m => m.role === 'tool');
    expect((toolResult as { content: string }).content).toContain('✅ 已记录');
  });
});

describe('agentLoop — error handling', () => {
  it('returns error message when tool throws', async () => {
    // Call a tool that doesn't exist to trigger error path
    mockLLM.mockResolvedValueOnce(llmToolCall('broken_tool', 'c3', {}));
    mockLLM.mockResolvedValueOnce(llmText('工具出错了'));

    const messages: Message[] = [{ role: 'user', content: '测试错误' }];
    const reply = await agentLoop(messages, makeEnv(env.DB, env.SESSION_KV));

    // Agent should not throw; tool error becomes a tool result message
    expect(reply).toBe('工具出错了');

    const secondCallMessages = mockLLM.mock.calls[1][0] as Message[];
    const toolResult = secondCallMessages.find(m => m.role === 'tool');
    expect((toolResult as { content: string }).content).toContain('未知工具');
  });

  it('returns 处理超时 if LLM keeps calling tools beyond MAX_ROUNDS', async () => {
    // Always return a tool call — should hit MAX_ROUNDS and return timeout message
    mockLLM.mockResolvedValue(llmToolCall('get_last_record', 'c4', {}));

    const messages: Message[] = [{ role: 'user', content: '循环测试' }];
    const reply = await agentLoop(messages, makeEnv(env.DB, env.SESSION_KV));

    expect(reply).toBe('处理超时，请重试。');
  });
});

describe('agentLoop — multi-turn context', () => {
  it('system prompt is always first in working messages', async () => {
    mockLLM.mockResolvedValueOnce(llmText('好'));

    const messages: Message[] = [
      { role: 'user', content: '第一条' },
      { role: 'assistant', content: '回复一' },
      { role: 'user', content: '第二条' },
    ];
    await agentLoop(messages, makeEnv(env.DB, env.SESSION_KV));

    const firstCallMessages = mockLLM.mock.calls[0][0] as Message[];
    expect(firstCallMessages[0].role).toBe('system');
    expect((firstCallMessages[0] as { role: 'system'; content: string }).content).toContain('摩托车');
  });
});
