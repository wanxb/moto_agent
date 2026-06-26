import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { handleAuthRequest } from '../src/routes/auth-handler';
import { getSession, parseSessionToken } from '../src/services/session';
import { getUserByEmail, getUserByTelegramId, createUser } from '../src/database';
import { initDB, clearDB } from './utils';

const E = { ...env, RESEND_API_KEY: 're_test', SENDER_EMAIL: 'no-reply@test.dev', DASHBOARD_URL: 'https://test.dev' } as unknown as typeof env & {
  RESEND_API_KEY: string; SENDER_EMAIL: string; DASHBOARD_URL: string;
};

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

// ── bind ──────────────────────────────────────────────────────────────────────

describe('POST /auth/bind', () => {
  it('binds telegram_id with a valid code', async () => {
    await createUser(env.DB, { email: 'g@x.com' });
    await env.SESSION_KV.put('bind_code:g@x.com', JSON.stringify({ code: '123456', telegram_id: '777' }));

    const res = await handleAuthRequest(jsonReq('POST', '/auth/bind', { email: 'g@x.com', code: '123456' }), E);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, merged: false });
    expect((await getUserByTelegramId(env.DB, '777'))!.email).toBe('g@x.com');
    // 验证码已消费
    expect(await env.SESSION_KV.get('bind_code:g@x.com')).toBeNull();
  });

  it('rejects a wrong code', async () => {
    await createUser(env.DB, { email: 'h@x.com' });
    await env.SESSION_KV.put('bind_code:h@x.com', JSON.stringify({ code: '123456', telegram_id: '777' }));
    const res = await handleAuthRequest(jsonReq('POST', '/auth/bind', { email: 'h@x.com', code: '000000' }), E);
    expect(res.status).toBe(400);
  });

  it('rejects when no code was issued', async () => {
    await createUser(env.DB, { email: 'i@x.com' });
    const res = await handleAuthRequest(jsonReq('POST', '/auth/bind', { email: 'i@x.com', code: '123456' }), E);
    expect(res.status).toBe(400);
  });
});
