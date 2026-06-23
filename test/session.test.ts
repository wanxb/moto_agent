import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { SELF } from 'cloudflare:test';
import { runAgent, MAX_SESSION_MESSAGES } from '../src/session';
import { initDB, clearDB, makeEnv } from './utils';
import type { Message } from '../src/types';

vi.mock('../src/agent', () => ({ agentLoop: vi.fn() }));
import { agentLoop } from '../src/agent';
const mockAgentLoop = agentLoop as ReturnType<typeof vi.fn>;

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => {
  await clearDB(env.DB);
  vi.clearAllMocks();
  // Clear all KV sessions
  const keys = await env.SESSION_KV.list();
  await Promise.all(keys.keys.map(k => env.SESSION_KV.delete(k.name)));
});

// ── Session persistence ───────────────────────────────────────────────────────

describe('KV session persistence', () => {
  it('saves user + assistant messages to KV after a turn', async () => {
    mockAgentLoop.mockImplementation(async (msgs: Message[]) => {
      msgs.push({ role: 'assistant', content: '已记录。' });
      return '已记录。';
    });
    const replies: string[] = [];

    await runAgent('111', '加了10升', makeEnv(env.DB, env.SESSION_KV), {
      reply: async t => { replies.push(t); },
    });

    expect(replies).toEqual(['已记录。']);
    const stored = JSON.parse((await env.SESSION_KV.get('session:111'))!) as Message[];
    expect(stored.at(-2)).toMatchObject({ role: 'user', content: '加了10升' });
    expect(stored.at(-1)).toMatchObject({ role: 'assistant' });
  });

  it('loads previous session and passes full history to agentLoop', async () => {
    const prev: Message[] = [
      { role: 'user',      content: '上次的问题' },
      { role: 'assistant', content: '上次的回答' },
    ];
    await env.SESSION_KV.put('session:222', JSON.stringify(prev));

    mockAgentLoop.mockResolvedValueOnce('继续对话');

    await runAgent('222', '新问题', makeEnv(env.DB, env.SESSION_KV), {
      reply: async () => {},
    });

    const calledWith = mockAgentLoop.mock.calls[0][0] as Message[];
    // Previous 2 + new user message
    expect(calledWith).toHaveLength(3);
    expect(calledWith[0].content).toBe('上次的问题');
    expect(calledWith[2].content).toBe('新问题');
  });

  it(`trims session to ${MAX_SESSION_MESSAGES} messages`, async () => {
    // 11 messages already in KV (> MAX)
    const many: Message[] = Array.from({ length: 11 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg ${i}`,
    }));
    await env.SESSION_KV.put('session:333', JSON.stringify(many));

    mockAgentLoop.mockImplementation(async (msgs: Message[]) => {
      msgs.push({ role: 'assistant', content: 'ok' });
      return 'ok';
    });
    await runAgent('333', '第12条', makeEnv(env.DB, env.SESSION_KV), {
      reply: async () => {},
    });

    const stored = JSON.parse((await env.SESSION_KV.get('session:333'))!) as Message[];
    expect(stored.length).toBeLessThanOrEqual(MAX_SESSION_MESSAGES);
    // Most recent messages should be kept (ends with assistant reply)
    expect(stored.at(-1)).toMatchObject({ role: 'assistant' });
  });

  it('starts fresh session when KV is empty', async () => {
    mockAgentLoop.mockResolvedValueOnce('首次回复');

    await runAgent('444', '第一条消息', makeEnv(env.DB, env.SESSION_KV), {
      reply: async () => {},
    });

    const calledWith = mockAgentLoop.mock.calls[0][0] as Message[];
    expect(calledWith).toHaveLength(1);
    expect(calledWith[0]).toMatchObject({ role: 'user', content: '第一条消息' });
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('replies with fallback message when agentLoop throws', async () => {
    mockAgentLoop.mockRejectedValueOnce(new Error('LLM 崩了'));
    const replies: string[] = [];

    await runAgent('555', '触发错误', makeEnv(env.DB, env.SESSION_KV), {
      reply: async t => { replies.push(t); },
    });

    expect(replies[0]).toBe('出错了，请稍后重试。');
  });

  it('still saves session to KV even when agentLoop throws', async () => {
    mockAgentLoop.mockRejectedValueOnce(new Error('崩了'));

    await runAgent('666', '出错的消息', makeEnv(env.DB, env.SESSION_KV), {
      reply: async () => {},
    });

    const stored = await env.SESSION_KV.get('session:666');
    expect(stored).not.toBeNull();
    const messages = JSON.parse(stored!) as Message[];
    expect(messages[0]).toMatchObject({ role: 'user', content: '出错的消息' });
  });
});

// ── Webhook security ──────────────────────────────────────────────────────────

describe('webhook secret validation', () => {
  it('rejects requests without correct secret (401)', async () => {
    const res = await SELF.fetch('https://moto-agent.workers.dev/telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Telegram-Bot-Api-Secret-Token': 'wrong-secret',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with no secret header (401)', async () => {
    const res = await SELF.fetch('https://moto-agent.workers.dev/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});
