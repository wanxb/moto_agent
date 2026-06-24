// KV 滑动窗口限流（复用 SESSION_KV namespace，零额外资源）。

import { RATE_LIMIT_PER_USER, RATE_LIMIT_GLOBAL, RATE_LIMIT_AUTH } from '../config';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;       // Unix timestamp（秒）
}

export interface RateLimitRule {
  windowSeconds: number; // 窗口大小
  maxRequests: number;   // 窗口内最大请求数
}

// 预定义规则（按业务语义命名，不按具体数字）
export const RULES: Record<string, RateLimitRule> = {
  'chat:per-user':   { windowSeconds: 60, maxRequests: RATE_LIMIT_PER_USER },
  'chat:global':     { windowSeconds: 60, maxRequests: RATE_LIMIT_GLOBAL },
  'auth:per-ip':     { windowSeconds: 300, maxRequests: RATE_LIMIT_AUTH },
};

interface Counter { count: number; resetAt: number }

export async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const record = await kv.get<Counter>(key, 'json');
  const ttl = Math.max(rule.windowSeconds, 60);  // KV 要求 TTL ≥ 60

  // 窗口过期 → 重置
  if (!record || now >= record.resetAt) {
    const resetAt = now + rule.windowSeconds;
    await kv.put(key, JSON.stringify({ count: 1, resetAt }), { expirationTtl: ttl });
    return { allowed: true, remaining: rule.maxRequests - 1, resetAt };
  }

  // 窗口内
  const count = record.count + 1;
  if (count > rule.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: record.resetAt };
  }

  // 递增（TTL 不刷新 — 到点自过期）
  await kv.put(key, JSON.stringify({ count, resetAt: record.resetAt }));
  return { allowed: true, remaining: rule.maxRequests - count, resetAt: record.resetAt };
}
