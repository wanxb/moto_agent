import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callLLM } from '../src/llm';
import type { Message, ToolDefinition } from '../src/types';

const DS_KEY  = 'test-ds-key';
const ANT_KEY = 'test-ant-key';

const MESSAGES: Message[] = [
  { role: 'user', content: '你好' },
];

const NO_TOOLS: ToolDefinition[] = [];

// ── Response factories ────────────────────────────────────────────────────────

function deepseekText(text: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: text, tool_calls: undefined } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function deepseekToolCall(name: string, args: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      },
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function deepseekError(status: number): Response {
  return new Response('Server Error', { status });
}


// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => { vi.restoreAllMocks(); });

describe('DeepSeek happy path', () => {
  it('returns text when model responds without tool calls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(deepseekText('你好！有什么可以帮你？'));

    const result = await callLLM(MESSAGES, NO_TOOLS, DS_KEY, ANT_KEY);

    expect(result.textContent).toBe('你好！有什么可以帮你？');
    expect(result.toolCalls).toBeNull();
  });

  it('parses tool calls correctly', async () => {
    const tools: ToolDefinition[] = [{
      type: 'function',
      function: { name: 'get_last_record', description: 'test', parameters: { type: 'object', properties: {}, required: [] } },
    }];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      deepseekToolCall('get_last_record', {})
    );

    const result = await callLLM(MESSAGES, tools, DS_KEY, ANT_KEY);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('get_last_record');
    expect(result.toolCalls![0].id).toBe('call_1');
  });

  it('parses tool call arguments correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      deepseekToolCall('log_fuel', { date: '2026-06-23', odometer: 12000, liters: 10, price_total: 98 })
    );

    const result = await callLLM(MESSAGES, NO_TOOLS, DS_KEY, ANT_KEY);

    expect(result.toolCalls![0].input).toEqual({
      date: '2026-06-23', odometer: 12000, liters: 10, price_total: 98,
    });
  });
});

describe('DeepSeek error handling', () => {
  it('does NOT retry on 4xx (bad request)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(deepseekError(400));

    await expect(callLLM(MESSAGES, NO_TOOLS, DS_KEY, ANT_KEY)).rejects.toThrow('HTTP 400');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 and succeeds on third attempt', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(deepseekError(500))
      .mockResolvedValueOnce(deepseekError(500))
      .mockResolvedValueOnce(deepseekText('第三次成功'));

    const result = await callLLM(MESSAGES, NO_TOOLS, DS_KEY, ANT_KEY);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.textContent).toBe('第三次成功');
  });

  it('succeeds on second attempt after transient 500', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(deepseekError(500))
      .mockResolvedValueOnce(deepseekText('重试成功'));

    const result = await callLLM(MESSAGES, NO_TOOLS, DS_KEY, '');
    expect(result.textContent).toBe('重试成功');
  });
});

describe('assistantMessage format', () => {
  it('returns an assistant message suitable for appending to history', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(deepseekText('好的'));

    const result = await callLLM(MESSAGES, NO_TOOLS, DS_KEY, ANT_KEY);
    expect(result.assistantMessage.role).toBe('assistant');
    expect(result.assistantMessage.content).toBe('好的');
  });

  it('includes tool_calls in assistant message when present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      deepseekToolCall('log_fuel', { odometer: 12000, liters: 10, price_total: 98, date: '2026-06-01' })
    );

    const result = await callLLM(MESSAGES, NO_TOOLS, DS_KEY, ANT_KEY);
    const msg = result.assistantMessage as { role: string; tool_calls?: unknown[] };
    expect(msg.tool_calls).toHaveLength(1);
  });
});
