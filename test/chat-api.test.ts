import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { handleChatRequest } from '../src/routes/chat-api';
import { createSession } from '../src/services/session';
import { createUser, getLastFuelRecord } from '../src/database';
import type { Env } from '../src/types';
import { initDB, clearDB } from './utils';

const E = env as unknown as Env;
let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => {
  await clearDB(env.DB);
  // 默认 DeepSeek 回复纯文本（无工具调用）
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(deepseekText('好的'));
});
afterEach(() => { vi.restoreAllMocks(); });

// ── DeepSeek 响应工厂（镜像 llm.test）────────────────────────────────────────
function deepseekText(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text, tool_calls: undefined } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function deepseekToolCall(name: string, args: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

// ── 请求 helpers ──────────────────────────────────────────────────────────────
async function sessionFor(email: string): Promise<{ id: number; cookie: string }> {
  const id = await createUser(env.DB, { email });
  const token = await createSession(env.SESSION_KV, { user_id: id, email });
  return { id, cookie: `session_token=${token}` };
}
function post(path: string, body: unknown, cookie?: string): Request {
  return new Request('https://test.dev' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}
function get(path: string, cookie?: string): Request {
  return new Request('https://test.dev' + path, { headers: cookie ? { Cookie: cookie } : {} });
}

// ── /chat/api ───────────────────────────────────────────────────────────────

describe('POST /chat/api', () => {
  it('401 without a session', async () => {
    const res = await handleChatRequest(post('/chat/api', { text: 'hi' }), E);
    expect(res.status).toBe(401);
  });

  it('400 on empty text', async () => {
    const a = await sessionFor('a@x.com');
    const res = await handleChatRequest(post('/chat/api', { text: '   ' }, a.cookie), E);
    expect(res.status).toBe(400);
  });

  it('returns reply and persists PWA history', async () => {
    const a = await sessionFor('b@x.com');
    const res = await handleChatRequest(post('/chat/api', { text: '你好' }, a.cookie), E);
    expect(res.status).toBe(200);
    expect((await res.json() as { reply: string }).reply).toBe('好的');

    // 历史持久化（独立于 Telegram）
    const h = await handleChatRequest(get('/chat/api?history=1', a.cookie), E);
    const msgs = (await h.json() as { messages: { role: string; content: string }[] }).messages;
    expect(msgs).toContainEqual({ role: 'user', content: '你好' });
    expect(msgs).toContainEqual({ role: 'assistant', content: '好的' });
  });

  it('routes a tool call under the session user (isolation)', async () => {
    const a = await sessionFor('c@x.com');
    fetchSpy
      .mockResolvedValueOnce(deepseekToolCall('log_fuel', { date: '2026-06-01', odometer: 1234, liters: 5, price_total: 50 }))
      .mockResolvedValueOnce(deepseekText('已记录加油 ✅'));

    const res = await handleChatRequest(post('/chat/api', { text: '加5升花50 里程1234' }, a.cookie), E);
    expect(res.status).toBe(200);
    expect((await res.json() as { reply: string }).reply).toContain('已记录');

    // 记录落在 user A 名下（无车 → 孤儿记录，仅靠 user_id 隔离）
    const rec = await getLastFuelRecord(env.DB, undefined, a.id);
    expect(rec?.odometer).toBe(1234);
    // 另一个用户看不到
    const b = await sessionFor('d@x.com');
    expect(await getLastFuelRecord(env.DB, undefined, b.id)).toBeNull();
  });
});

// ── GET /chat/api?history=1 ───────────────────────────────────────────────────

describe('GET /chat/api history', () => {
  it('401 without a session', async () => {
    const res = await handleChatRequest(get('/chat/api?history=1'), E);
    expect(res.status).toBe(401);
  });

  it('empty for a fresh user', async () => {
    const a = await sessionFor('e@x.com');
    const res = await handleChatRequest(get('/chat/api?history=1', a.cookie), E);
    expect((await res.json() as { messages: unknown[] }).messages).toEqual([]);
  });
});

// ── /chat/voice 守卫 ──────────────────────────────────────────────────────────

describe('POST /chat/voice guards', () => {
  it('401 without a session', async () => {
    const res = await handleChatRequest(new Request('https://test.dev/chat/voice', { method: 'POST' }), E);
    expect(res.status).toBe(401);
  });

  it('400 when no audio part', async () => {
    const a = await sessionFor('f@x.com');
    const req = new Request('https://test.dev/chat/voice', { method: 'POST', headers: { Cookie: a.cookie }, body: new FormData() });
    const res = await handleChatRequest(req, E);
    expect(res.status).toBe(400);
  });
});
