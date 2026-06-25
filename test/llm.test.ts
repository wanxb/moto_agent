import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callDeepSeek } from '../src/llm-transport';
import type { Message, ToolDefinition } from '../src/types';

const DS_KEY  = 'test-ds-key';

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

    const result = await callDeepSeek(MESSAGES, NO_TOOLS, DS_KEY);

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

    const result = await callDeepSeek(MESSAGES, tools, DS_KEY);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('get_last_record');
    expect(result.toolCalls![0].id).toBe('call_1');
  });

  it('parses tool call arguments correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      deepseekToolCall('log_fuel', { date: '2026-06-23', odometer: 12000, liters: 10, price_total: 98 })
    );

    const result = await callDeepSeek(MESSAGES, NO_TOOLS, DS_KEY);

    expect(result.toolCalls![0].input).toEqual({
      date: '2026-06-23', odometer: 12000, liters: 10, price_total: 98,
    });
  });

  it('passes model name when provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(deepseekText('ok'));
    await callDeepSeek(MESSAGES, NO_TOOLS, DS_KEY, 'deepseek-v4-pro');

    const options = fetchSpy.mock.calls[0][1] as { body: string };
    const callBody = JSON.parse(options.body) as { model: string };
    expect(callBody.model).toBe('deepseek-v4-pro');
  });

  it('uses default model when model param omitted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(deepseekText('ok'));
    await callDeepSeek(MESSAGES, NO_TOOLS, DS_KEY);

    const options = fetchSpy.mock.calls[0][1] as { body: string };
    const callBody = JSON.parse(options.body) as { model: string };
    expect(callBody.model).toBe('deepseek-v4-flash');
  });
});

describe('assistantMessage format', () => {
  it('returns an assistant message suitable for appending to history', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(deepseekText('好的'));

    const result = await callDeepSeek(MESSAGES, NO_TOOLS, DS_KEY);
    expect(result.assistantMessage.role).toBe('assistant');
    expect(result.assistantMessage.content).toBe('好的');
  });

  it('includes tool_calls in assistant message when present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      deepseekToolCall('log_fuel', { odometer: 12000, liters: 10, price_total: 98, date: '2026-06-01' })
    );

    const result = await callDeepSeek(MESSAGES, NO_TOOLS, DS_KEY);
    const msg = result.assistantMessage as { role: string; tool_calls?: unknown[] };
    expect(msg.tool_calls).toHaveLength(1);
  });
});
