// 认证路由（spec 016）— Magic Link 登录 + 登出 + Telegram 绑定。
// 鉴权在 API 层：本模块只处理 /auth/*。页面（登录/设置）是 web/ SPA，不在这里渲染。
// 唯一的服务端 HTML 是 GET /auth/verify 的确认页（防邮件安全网关预取一次性 token，见 design §3.1）。

import type { Env } from '../types';
import type { Lang } from '../i18n/types';
import { t, getLang } from '../i18n';
import { MAGIC_LINK_TTL, GOOGLE_OAUTH_STATE_TTL } from '../config';
import { pushPwaNotice } from './chat-api';
import { checkRateLimit, RULES } from '../gateway/rate-limiter';
import { sendMagicLinkEmail } from '../services/mail';
import {
  createSession, destroySession, parseSessionToken, buildSessionCookie, clearSessionCookie,
} from '../services/session';
import {
  getUserByEmail, getUserById, createUser, updateUserLastLogin, updateUserLang, bindTelegramToUser,
  getOrCreateTelegramUser,
} from '../database';
import { verifyAutoLoginToken } from '../services/auto-login';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
function html(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}
function baseUrl(request: Request, env: Env): string {
  // DASHBOARD_URL 可能带 /dashboard 等路径，认证/绑定链接需要干净的 origin。
  if (env.DASHBOARD_URL) { try { return new URL(env.DASHBOARD_URL).origin; } catch { /* 回退请求 origin */ } }
  return new URL(request.url).origin;
}
function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ── 路由分发 ──────────────────────────────────────────────────────────────────

export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const m = request.method;

  if (pathname === '/auth/send-link' && m === 'POST') return sendLink(request, env);
  if (pathname === '/auth/verify'    && m === 'GET')  return verifyPage(request, env);
  if (pathname === '/auth/verify'    && m === 'POST') return verifyConsume(request, env);
  if (pathname === '/auth/logout'    && m === 'POST') return logout(request, env);
  if (pathname === '/auth/bind'      && m === 'GET')  return bindPage(request, env);
  if (pathname === '/auth/bind'      && m === 'POST') return bindConsume(request, env);
  if (pathname === '/auth/auto-login' && m === 'GET') return autoLogin(request, env);
  if (pathname === '/auth/google'           && m === 'GET') return googleLogin(request, env);
  if (pathname === '/auth/google/callback'  && m === 'GET') return googleCallback(request, env);
  return json(404, { error: 'not_found' });
}

// ── POST /auth/send-link ──────────────────────────────────────────────────────

async function sendLink(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { email?: string };
  const email = (body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json(400, { error: 'invalid_email' });

  // email + IP 限流，防邮件轰炸/反射
  const rl = await checkRateLimit(env.SESSION_KV, `auth:send:${email}:${clientIp(request)}`, RULES['auth:send']);
  if (!rl.allowed) return json(429, { error: 'rate_limited' });

  const token = crypto.randomUUID();
  const expiresAt = nowSec() + MAGIC_LINK_TTL;
  await env.SESSION_KV.put(`magic_link:${token}`, JSON.stringify({ email, expiresAt }), { expirationTtl: MAGIC_LINK_TTL });

  const link = `${baseUrl(request, env)}/auth/verify?token=${token}`;
  try {
    await sendMagicLinkEmail(env, email, link);
  } catch (e) {
    return json(502, { error: 'mail_failed', message: e instanceof Error ? e.message : '邮件发送失败' });
  }
  return json(200, { ok: true });
}

// ── GET /auth/verify?token= —— 仅渲染确认页，不消费 token（防扫描器预取）─────────

async function verifyPage(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') || '';
  const rec = await readMagicLink(env, token);
  if (!rec) return html(410, page('链接已失效', '此登录链接已过期或已被使用，请回到登录页重新申请。'));

  // 注意：不删除 token、不建 session。需用户点击按钮 POST 才消费。
  return html(200, `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>确认登录 · 弼马温</title>${STYLE}</head>
<body><div class="card">
<h1>🏍 确认登录弼马温</h1>
<p>点击下方按钮完成登录。</p>
<form method="POST" action="/auth/verify">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<button type="submit">确认登录</button>
</form>
</div></body></html>`);
}

// ── POST /auth/verify —— 消费一次性 token → 建 session → 302 ────────────────────

async function verifyConsume(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const token = form ? String(form.get('token') ?? '') : '';

  const rec = await readMagicLink(env, token);
  if (!rec) return html(410, page('链接已失效', '此登录链接已过期或已被使用，请回到登录页重新申请。'));
  await env.SESSION_KV.delete(`magic_link:${token}`);   // 一次性消费

  let user = await getUserByEmail(env.DB, rec.email);
  if (!user) {
    const id = await createUser(env.DB, { email: rec.email });
    user = await getUserById(env.DB, id);
  }
  if (!user) return html(500, page('登录失败', '账号创建异常，请稍后重试。'));

  await updateUserLastLogin(env.DB, user.id, new Date().toISOString());
  const sToken = await createSession(env.SESSION_KV, { user_id: user.id, email: user.email });

  return new Response(null, {
    status: 302,
    headers: { Location: `${baseUrl(request, env)}/chat`, 'Set-Cookie': buildSessionCookie(sToken) },
  });
}

// ── POST /auth/logout ─────────────────────────────────────────────────────────

async function logout(request: Request, env: Env): Promise<Response> {
  const token = parseSessionToken(request.headers.get('Cookie'));
  if (token) await destroySession(env.SESSION_KV, token);
  return new Response(null, {
    status: 302,
    headers: { Location: `${baseUrl(request, env)}/login`, 'Set-Cookie': clearSessionCookie() },
  });
}

// ── 账号绑定（链接式，仅 Telegram 发起）──────────────────────────────────────────
// 流程：TG /bind <email> → 邮件验证链接 → 用户点击 → 确认页(防预取) → POST 消费 →
//       get-or-create 邮箱账号 → 把该 TG 账号数据合并进来 → 建 session → 302 /chat。
// PWA 完全不参与；纯 PWA 用户无需知道 Telegram 存在。

// GET /auth/bind?token= —— 仅渲染确认页，不消费 token（防邮件网关预取）。
async function bindPage(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') || '';
  const rec = await readBindLink(env, token);
  if (!rec) return html(410, page('链接已失效', '此绑定链接已过期或已被使用，请回到 Telegram 重新发送 /bind。'));

  return html(200, `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>确认绑定 · 弼马温</title>${STYLE}</head>
<body><div class="card">
<h1>🏍 确认绑定账号</h1>
<p>点击下方按钮，将你的记录绑定到 <b>${escapeHtml(rec.email)}</b>。</p>
<form method="POST" action="/auth/bind">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<button type="submit">确认绑定</button>
</form>
</div></body></html>`);
}

// POST /auth/bind —— 消费一次性 token → get-or-create 邮箱账号 → 合并 TG 数据 → session → 302。
async function bindConsume(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const token = form ? String(form.get('token') ?? '') : '';

  const rec = await readBindLink(env, token);
  if (!rec) return html(410, page('链接已失效', '此绑定链接已过期或已被使用，请回到 Telegram 重新发送 /bind。'));
  await env.SESSION_KV.delete(`bind_link:${token}`);   // 一次性消费

  // 邮箱账号不存在则创建（邮箱是账号主键，TG 仅是数据来源）
  let user = await getUserByEmail(env.DB, rec.email);
  if (!user) {
    const id = await createUser(env.DB, { email: rec.email });
    user = await getUserById(env.DB, id);
  }
  if (!user) return html(500, page('绑定失败', '账号创建异常，请稍后重试。'));

  let mergeRes: { merged: boolean; duplicateNames: string[] };
  try {
    mergeRes = await bindTelegramToUser(env.DB, rec.email, rec.telegram_id);   // 含账号合并（情形 B）
  } catch (e) {
    return html(400, page('绑定失败', e instanceof Error ? e.message : '绑定失败，请稍后重试。'));
  }

  // 合并是并集不去重：若两端各有同名车，提示用户去处理（选项 3，design §3.2）。
  if (mergeRes.duplicateNames.length) {
    const lang: Lang = user.lang === 'en' ? 'en' : 'zh';
    const sep = lang === 'en' ? ', ' : '、';
    await pushPwaNotice(
      env, user.id,
      t('bind.merge_dups', lang, String(mergeRes.duplicateNames.length), mergeRes.duplicateNames.join(sep)),
    );
  }

  await updateUserLastLogin(env.DB, user.id, new Date().toISOString());
  const sToken = await createSession(env.SESSION_KV, { user_id: user.id, email: user.email });
  return new Response(null, {
    status: 302,
    headers: { Location: `${baseUrl(request, env)}/chat`, 'Set-Cookie': buildSessionCookie(sToken) },
  });
}

// ── GET /auth/auto-login?t= —— 自包含 HMAC 签名 token，零 KV，零状态 ────────

async function autoLogin(request: Request, env: Env): Promise<Response> {
  const token = new URL(request.url).searchParams.get('t') || '';
  const telegramId = await verifyAutoLoginToken(token, env.TELEGRAM_WEBHOOK_SECRET);
  if (!telegramId) return html(410, page('链接已失效', '登录链接已过期或已被使用，请回到 Telegram 重新输入 /dashboard。'));

  const userId = await getOrCreateTelegramUser(env.DB, telegramId);
  await updateUserLastLogin(env.DB, userId, new Date().toISOString());

  // 将 Telegram bot 中的语言偏好同步到 PWA：KV → DB + URL 参数
  const tgLang = await getLang(env.SESSION_KV, telegramId);
  if (tgLang) {
    await updateUserLang(env.DB, userId, tgLang);
  }

  const langParam = tgLang ? `&lang=${tgLang}` : '';
  const sToken = await createSession(env.SESSION_KV, { user_id: userId, email: null });
  return new Response(null, {
    status: 302,
    headers: { Location: `${baseUrl(request, env)}/dashboard?from=tg${langParam}`, 'Set-Cookie': buildSessionCookie(sToken) },
  });
}

// ── GET /auth/google —— 发起 Google OAuth Authorization Code Flow ──────────

async function googleLogin(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID) {
    return html(500, page('未配置', 'Google 登录尚未配置。请联系管理员设置 GOOGLE_CLIENT_ID。'));
  }
  const state = crypto.randomUUID();
  await env.SESSION_KV.put(
    `oauth_state:${state}`,
    JSON.stringify({ expiresAt: nowSec() + GOOGLE_OAUTH_STATE_TTL }),
    { expirationTtl: GOOGLE_OAUTH_STATE_TTL },
  );

  const redirectUri = `${baseUrl(request, env)}/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
  });
  return new Response(null, {
    status: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
  });
}

// ── GET /auth/google/callback —— OAuth 回调：换 token → 拿 email → 建 session ─

async function googleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';

  // 1. 校验 state（CSRF 防护）
  if (!state) return html(403, page('请求无效', '缺少 state 参数，登录请求不合法。'));
  const stateRaw = await env.SESSION_KV.get(`oauth_state:${state}`);
  if (!stateRaw) return html(403, page('链接已失效', '登录会话已过期，请回到登录页重新开始。'));
  await env.SESSION_KV.delete(`oauth_state:${state}`);  // 一次性消费

  const stateRec = JSON.parse(stateRaw) as { expiresAt: number };
  if (nowSec() >= stateRec.expiresAt) {
    return html(403, page('链接已失效', '登录会话已过期，请回到登录页重新开始。'));
  }

  if (!code) {
    const errorDesc = url.searchParams.get('error_description') || url.searchParams.get('error') || '用户取消了授权';
    return html(403, page('授权失败', `Google 授权失败：${escapeHtml(errorDesc)}`));
  }

  // 2. 交换 code → tokens
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return html(500, page('未配置', 'Google 登录尚未配置。'));
  }

  const redirectUri = `${baseUrl(request, env)}/auth/google/callback`;
  let tokenRes: Response;
  try {
    tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
  } catch (e) {
    return html(502, page('服务异常', '无法连接 Google 服务，请稍后重试。'));
  }

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    console.error('[auth] google token exchange failed:', tokenRes.status, errText);
    return html(502, page('授权失败', 'Google 授权校验失败，请回到登录页重试。'));
  }

  const tokenData = await tokenRes.json() as { id_token?: string; access_token?: string };
  const idToken = tokenData.id_token;
  if (!idToken) {
    return html(502, page('授权失败', 'Google 未返回身份令牌，请重试。'));
  }

  // 3. 解析 id_token JWT（不经签名验证——token 来自 Google HTTPS server-to-server 回包）
  const payload = parseJwtPayload(idToken);
  if (!payload) {
    return html(502, page('授权失败', '无法解析 Google 身份令牌。'));
  }

  // 验 aud（确保 token 是发给我们的）
  if (payload.aud !== env.GOOGLE_CLIENT_ID) {
    console.error('[auth] google id_token aud mismatch:', payload.aud, '!=', env.GOOGLE_CLIENT_ID);
    return html(403, page('授权失败', '身份令牌 audience 不匹配。'));
  }

  const email = (payload.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || !payload.email_verified) {
    return html(403, page('授权失败', 'Google 账号邮箱未验证，无法登录。'));
  }

  const name = typeof payload.name === 'string' ? payload.name : undefined;

  // 4. Find-or-create user（按 email，与 Magic Link 共用用户模型）
  let user = await getUserByEmail(env.DB, email);
  if (!user) {
    const id = await createUser(env.DB, { email, nickname: name });
    user = await getUserById(env.DB, id);
  }
  if (!user) return html(500, page('登录失败', '账号创建异常，请稍后重试。'));

  await updateUserLastLogin(env.DB, user.id, new Date().toISOString());
  const sToken = await createSession(env.SESSION_KV, { user_id: user.id, email: user.email });

  return new Response(null, {
    status: 302,
    headers: { Location: `${baseUrl(request, env)}/chat`, 'Set-Cookie': buildSessionCookie(sToken) },
  });
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** 读 magic_link 并做防御性过期校验（KV TTL 之外再查一道）。不删除。 */
async function readMagicLink(env: Env, token: string): Promise<{ email: string; expiresAt: number } | null> {
  if (!token) return null;
  const raw = await env.SESSION_KV.get(`magic_link:${token}`);
  if (!raw) return null;
  const rec = JSON.parse(raw) as { email: string; expiresAt: number };
  if (rec.expiresAt && nowSec() >= rec.expiresAt) return null;
  return rec;
}

/** 读 bind_link 并做防御性过期校验。不删除。 */
async function readBindLink(env: Env, token: string): Promise<{ email: string; telegram_id: string; expiresAt: number } | null> {
  if (!token) return null;
  const raw = await env.SESSION_KV.get(`bind_link:${token}`);
  if (!raw) return null;
  const rec = JSON.parse(raw) as { email: string; telegram_id: string; expiresAt: number };
  if (rec.expiresAt && nowSec() >= rec.expiresAt) return null;
  return rec;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** 解析 JWT payload（中间段 base64url decode → JSON），不验签名（token 来自 Google HTTPS server-to-server 回包） */
function parseJwtPayload(jwt: string): { aud?: string; email?: string; email_verified?: boolean; name?: string } | null {
  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    // base64url → base64 → decode
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const STYLE = `<style>
:root{color-scheme:dark}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#111827;color:#f3f4f6;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
.card{background:#1f2937;border:1px solid #374151;border-radius:14px;padding:28px;max-width:360px;width:100%;text-align:center}
h1{font-size:1.2rem;margin-bottom:12px}
p{color:#9ca3af;margin-bottom:20px;line-height:1.5}
button{width:100%;padding:13px;border:none;border-radius:10px;background:#f59e0b;color:#000;font-size:1rem;font-weight:600;cursor:pointer}
button:active{opacity:.85}
</style>`;

function page(title: string, msg: string): string {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} · 弼马温</title>${STYLE}</head>
<body><div class="card"><h1>🏍 ${escapeHtml(title)}</h1><p>${escapeHtml(msg)}</p></div></body></html>`;
}
