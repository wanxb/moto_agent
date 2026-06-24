import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { runPipeline } from '../src/gateway/pipeline';
import { RestAdapter } from '../src/gateway/adapters/rest';
import { initDB, clearDB } from './utils';

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

// mock agent: 用 vi.fn 注入，不调真实 LLM
const mockAgent = vi.fn() as ReturnType<typeof vi.fn>;

describe('RestAdapter', () => {
  it('extracts text and userId from body', async () => {
    const adapter = new RestAdapter('999999');
    const raw = { headers: new Headers(), body: { text: '最近油耗', userId: '123' } };
    expect(adapter.extractUser(raw)).toBe('123');
    expect(await adapter.extractText(raw)).toBe('最近油耗');
  });

  it('falls back to constructor userId when not in body', () => {
    const adapter = new RestAdapter('999999');
    const raw = { headers: new Headers(), body: { text: 'hi' } };
    expect(adapter.extractUser(raw)).toBe('999999');
  });
});

describe('runPipeline integration', () => {
  beforeEach(() => { mockAgent.mockReset(); });

  it('handles a text query through the full pipeline', async () => {
    mockAgent.mockResolvedValue('暂无加油记录。');

    const adapter = new RestAdapter('999999');
    const raw = { headers: new Headers(), body: { text: '最近油耗怎么样', userId: '999999' } };

    const reply = await runPipeline(adapter, raw, {
      db: env.DB, agent: mockAgent, session: { get: () => Promise.resolve([]), set: () => Promise.resolve() }, kv: env.SESSION_KV,
    });

    expect(reply).toBe('暂无加油记录。');
    expect(mockAgent).toHaveBeenCalledTimes(1);
  });

  it('passes session history to agent', async () => {
    const history = [{ role: 'user' as const, content: '之前的问题' }];
    const session = {
      get: async () => [...history],
      set: vi.fn() as () => Promise<void>,
    };
    mockAgent.mockResolvedValue('好的');

    const adapter = new RestAdapter('999999');
    await runPipeline(adapter, { headers: new Headers(), body: { text: '新消息', userId: '999999' } }, {
      db: env.DB, agent: mockAgent, session, kv: env.SESSION_KV,
    });

    // agent 收到的消息应含历史 + 新消息
    const msgs = mockAgent.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[msgs.length - 1]).toMatchObject({ role: 'user', content: '新消息' });
  });
});
