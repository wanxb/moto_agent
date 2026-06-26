// 登录 Session 管理（spec 016）— 基于 SESSION_KV 的不透明 token + HttpOnly cookie。
// token 为随机 UUID，本身不含用户信息；过期即废。滑动续期见 getSession。

import { AUTH_SESSION_TTL, SESSION_RENEW_THRESHOLD } from '../config';

export interface SessionData {
  user_id: number;
  email: string | null;
  created_at: string;
  expiresAt: number;        // Unix 秒；KV TTL 之外再存一份做防御性校验 + 续期判定
}

const SESSION_PREFIX = 'session:';
const COOKIE_NAME = 'session_token';

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** 创建 session：生成 token、写 KV（30 天 TTL）、返回 token（供 Set-Cookie）。 */
export async function createSession(
  kv: KVNamespace, user: { user_id: number; email: string | null },
): Promise<string> {
  const token = crypto.randomUUID();
  const now = nowSec();
  const data: SessionData = {
    user_id: user.user_id,
    email: user.email,
    created_at: new Date(now * 1000).toISOString(),
    expiresAt: now + AUTH_SESSION_TTL,
  };
  await kv.put(SESSION_PREFIX + token, JSON.stringify(data), { expirationTtl: AUTH_SESSION_TTL });
  return token;
}

/** 校验 session：过期→删除并返回 null；剩余 TTL < 阈值→滑动续期到满。 */
export async function getSession(kv: KVNamespace, token: string): Promise<SessionData | null> {
  if (!token) return null;
  const raw = await kv.get(SESSION_PREFIX + token);
  if (!raw) return null;

  const data = JSON.parse(raw) as SessionData;
  const now = nowSec();

  if (data.expiresAt && now >= data.expiresAt) {
    await kv.delete(SESSION_PREFIX + token);
    return null;
  }

  // 滑动续期：活跃用户长期免重登，写操作仅在跨过阈值时触发
  if (!data.expiresAt || data.expiresAt - now < SESSION_RENEW_THRESHOLD) {
    data.expiresAt = now + AUTH_SESSION_TTL;
    await kv.put(SESSION_PREFIX + token, JSON.stringify(data), { expirationTtl: AUTH_SESSION_TTL });
  }
  return data;
}

export async function destroySession(kv: KVNamespace, token: string): Promise<void> {
  if (token) await kv.delete(SESSION_PREFIX + token);
}

/** 便捷：从 Request 的 Cookie 解析 token 并校验 session（含滑动续期）。无效返回 null。 */
export async function resolveSessionFromRequest(request: Request, kv: KVNamespace): Promise<SessionData | null> {
  return getSession(kv, parseSessionToken(request.headers.get('Cookie')) ?? '');
}

/** 从 Cookie header 提取 session token。 */
export function parseSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return m ? m[1] : null;
}

/** 构造登录 Set-Cookie（HttpOnly + Secure + SameSite=Lax，防 XSS 窃取与 CSRF）。 */
export function buildSessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${AUTH_SESSION_TTL}`;
}

/** 构造登出用的清除 Cookie。 */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
