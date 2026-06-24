import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { checkRateLimit } from '../src/gateway/rate-limiter';

beforeEach(async () => {
  // 清掉上一轮测试留的 KV 限流 key
  await env.SESSION_KV.delete('rate:test:user');
});

describe('checkRateLimit (KV sliding window)', () => {
  const RULE = { windowSeconds: 60, maxRequests: 3 };

  it('first request is allowed with full remaining count', async () => {
    const r = await checkRateLimit(env.SESSION_KV, 'rate:test:user', RULE);
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it('denies when count exceeds maxRequests', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit(env.SESSION_KV, 'rate:test:user', RULE);
      expect(r.allowed).toBe(true);
    }
    const denied = await checkRateLimit(env.SESSION_KV, 'rate:test:user', RULE);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });
});
