import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';
import { handleAuthRequest } from '../src/routes/auth-handler';
import { getSession, createSession, parseSessionToken } from '../src/services/session';
import {
  getUserByEmail, getUserByTelegramId, getUserById, createUser,
  insertFuelRecord, getRecentFuelRecords,
} from '../src/database';
import type { Env } from '../src/types';
import { signAutoLoginToken } from '../src/services/auto-login';
import { initDB, clearDB } from './utils';

const E = { ...env, RESEND_API_KEY: 're_test', SENDER_EMAIL: 'no-reply@test.dev', DASHBOARD_URL: 'https://test.dev' } as unknown as Env;

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => {
  await clearDB(env.DB);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));
});
afterEach(() => { vi.restoreAllMocks(); });

// ── 请求构造 helpers ──────────────────────────────────────────────────────────

function jsonReq(method: string, path: string, body?: unknown, ip = '1.2.3.4'): Request {
  const headers: Record<string, string> = { 'CF-Connecting-IP': ip };
  let payload: string | undefined;
  if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  return new Request('https://test.dev' + path, { method, headers, body: payload });
}
function formReq(path: string, fields: Record<string, string>): Request {
  return new Request('https://test.dev' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '1.2.3.4' },
    body: new URLSearchParams(fields).toString(),
  });
}
// 从 Resend 发信的 body 里抽出 magic link token
function lastSentToken(): string {
  const body = JSON.parse((fetchSpy.mock.calls.at(-1)![1] as { body: string }).body) as { text: string };
  return body.text.match(/\/auth\/verify\?token=([\w-]+)/)![1];
}

// ── send-link ─────────────────────────────────────────────────────────────────

describe('POST /auth/send-link', () => {
  it('sends a magic link and stores token', async () => {
    const res = await handleAuthRequest(jsonReq('POST', '/auth/send-link', { email: 'a@x.com' }), E);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // 调了 Resend
    expect(fetchSpy).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({ method: 'POST' }));
    const token = lastSentToken();
    expect(await env.SESSION_KV.get(`magic_link:${token}`)).not.toBeNull();
  });

  it('rejects invalid email', async () => {
    const res = await handleAuthRequest(jsonReq('POST', '/auth/send-link', { email: 'not-an-email' }), E);
    expect(res.status).toBe(400);
  });

  it('rate-limits after 5 attempts (email+IP)', async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await handleAuthRequest(jsonReq('POST', '/auth/send-link', { email: 'rl@x.com' }, '9.9.9.9'), E);
      expect(ok.status).toBe(200);
    }
    const blocked = await handleAuthRequest(jsonReq('POST', '/auth/send-link', { email: 'rl@x.com' }, '9.9.9.9'), E);
    expect(blocked.status).toBe(429);
  });

  it('returns 502 when mail provider fails', async () => {
    fetchSpy.mockResolvedValue(new Response('bad', { status: 500 }));
    const res = await handleAuthRequest(jsonReq('POST', '/auth/send-link', { email: 'b@x.com' }), E);
    expect(res.status).toBe(502);
  });
});

// ── verify（防预取两步）────────────────────────────────────────────────────────

describe('GET/POST /auth/verify', () => {
  it('GET renders confirm page WITHOUT consuming the token', async () => {
    await handleAuthRequest(jsonReq('POST', '/auth/send-link', { email: 'c@x.com' }), E);
    const token = lastSentToken();

    const res = await handleAuthRequest(new Request(`https://test.dev/auth/verify?token=${token}`), E);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('确认登录');
    // token 仍在 → 未被消费（扫描器预取不消费）
    expect(await env.SESSION_KV.get(`magic_link:${token}`)).not.toBeNull();
  });

  it('GET with unknown token shows expired page', async () => {
    const res = await handleAuthRequest(new Request('https://test.dev/auth/verify?token=nope'), E);
    expect(res.status).toBe(410);
  });

  it('POST consumes token, creates user, sets session cookie, redirects', async () => {
    await handleAuthRequest(jsonReq('POST', '/auth/send-link', { email: 'd@x.com' }), E);
    const token = lastSentToken();

    const res = await handleAuthRequest(formReq('/auth/verify', { token }), E);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://test.dev/chat');

    const cookie = res.headers.get('Set-Cookie') || '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');

    // 用户已创建
    expect(await getUserByEmail(env.DB, 'd@x.com')).not.toBeNull();
    // session 有效
    const sToken = parseSessionToken(cookie)!;
    const session = await getSession(env.SESSION_KV, sToken);
    expect(session!.email).toBe('d@x.com');

    // token 已消费 → 二次 POST 失效
    const again = await handleAuthRequest(formReq('/auth/verify', { token }), E);
    expect(again.status).toBe(410);
  });

  it('POST logs in existing user without duplicating', async () => {
    await createUser(env.DB, { email: 'e@x.com', nickname: 'E' });
    await handleAuthRequest(jsonReq('POST', '/auth/send-link', { email: 'e@x.com' }), E);
    const token = lastSentToken();
    const res = await handleAuthRequest(formReq('/auth/verify', { token }), E);
    expect(res.status).toBe(302);
    // 仍只有一个 e@x.com
    const u = await getUserByEmail(env.DB, 'e@x.com');
    expect(u!.nickname).toBe('E');
  });
});

// ── logout ────────────────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('clears the session and cookie', async () => {
    await handleAuthRequest(jsonReq('POST', '/auth/send-link', { email: 'f@x.com' }), E);
    const verify = await handleAuthRequest(formReq('/auth/verify', { token: lastSentToken() }), E);
    const sToken = parseSessionToken(verify.headers.get('Set-Cookie') || '')!;

    const req = new Request('https://test.dev/auth/logout', {
      method: 'POST', headers: { Cookie: `session_token=${sToken}` },
    });
    const res = await handleAuthRequest(req, E);
    expect(res.status).toBe(302);
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(await getSession(env.SESSION_KV, sToken)).toBeNull();
  });
});

// ── bind（链接式，仅 TG 发起）──────────────────────────────────────────────────

const future = () => Math.floor(Date.now() / 1000) + 600;

describe('GET/POST /auth/bind (link-based)', () => {
  it('GET renders confirm page WITHOUT consuming the token', async () => {
    await env.SESSION_KV.put('bind_link:btok1', JSON.stringify({ email: 'g@x.com', telegram_id: '777', expiresAt: future() }));
    const res = await handleAuthRequest(new Request('https://test.dev/auth/bind?token=btok1'), E);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('确认绑定');
    expect(await env.SESSION_KV.get('bind_link:btok1')).not.toBeNull();   // 未消费
  });

  it('POST creates email account, merges TG data, sets session, consumes token', async () => {
    // 先有一个 TG-only 账号且名下有数据（开放自助下首次发消息自动建的那种）
    const tgUser = await createUser(env.DB, { telegramId: '888' });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 100, liters: 5, price_total: 50, user_id: tgUser });
    await env.SESSION_KV.put('bind_link:btok2', JSON.stringify({ email: 'merge@x.com', telegram_id: '888', expiresAt: future() }));

    const res = await handleAuthRequest(formReq('/auth/bind', { token: 'btok2' }), E);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://test.dev/chat');

    // 邮箱账号已建并挂上 telegram_id
    const emailUser = await getUserByEmail(env.DB, 'merge@x.com');
    expect(emailUser!.telegram_id).toBe('888');
    // TG 名下数据已并入邮箱账号
    expect((await getRecentFuelRecords(env.DB, 10, undefined, emailUser!.id)).length).toBe(1);
    // 旧 TG-only 账号失活
    expect((await getUserById(env.DB, tgUser))!.status).toBe('merged');
    // session 有效 + token 已消费
    const cookie = res.headers.get('Set-Cookie') || '';
    expect((await getSession(env.SESSION_KV, parseSessionToken(cookie)!))!.email).toBe('merge@x.com');
    expect(await env.SESSION_KV.get('bind_link:btok2')).toBeNull();
  });

  it('rejects an unknown/expired token', async () => {
    const res = await handleAuthRequest(formReq('/auth/bind', { token: 'nope' }), E);
    expect(res.status).toBe(410);
  });
});

// ── worker 路由接入（T4-A）──────────────────────────────────────────────────────

describe('worker routing (index.ts)', () => {
  it('routes /auth/* to the auth handler', async () => {
    const res = await worker.fetch!(jsonReq('POST', '/auth/send-link', { email: 'w@x.com' }), E);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('/api/v1/me → 401 without session, user with session', async () => {
    const noSession = await worker.fetch!(new Request('https://test.dev/api/v1/me'), E);
    expect(noSession.status).toBe(401);

    const id = await createUser(env.DB, { email: 'me@x.com', nickname: 'Me' });
    const token = await createSession(env.SESSION_KV, { user_id: id, email: 'me@x.com' });
    const withSession = await worker.fetch!(
      new Request('https://test.dev/api/v1/me', { headers: { Cookie: `session_token=${token}` } }), E,
    );
    expect(withSession.status).toBe(200);
    expect((await withSession.json() as { user: { email: string } }).user.email).toBe('me@x.com');
  });

  it('legacy dashboard ?token= still works', async () => {
    const res = await worker.fetch!(new Request(`https://test.dev/api/v1/vehicles?token=${E.ALLOWED_CHAT_ID}`), E);
    expect(res.status).toBe(200);
  });

  it('GET /auth/auto-login → creates session → 302 /dashboard', async () => {
    const token = await signAutoLoginToken('555', E.TELEGRAM_WEBHOOK_SECRET);
    const url = `https://test.dev/auth/auto-login?t=${encodeURIComponent(token)}`;
    const res = await worker.fetch!(new Request(url), E);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://test.dev/dashboard?from=tg');
    expect(res.headers.get('Set-Cookie')).toContain('session_token=');
    // 用户已创建（TG 开放自助）
    expect(await getUserByTelegramId(env.DB, '555')).not.toBeNull();
  });

  it('GET /auth/auto-login invalid/expired token → 410', async () => {
    const res = await worker.fetch!(new Request('https://test.dev/auth/auto-login?t=garbage'), E);
    expect(res.status).toBe(410);
  });
});
