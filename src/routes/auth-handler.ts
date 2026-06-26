// 认证路由（spec 016）— Magic Link 登录 + 登出 + Telegram 绑定。
// 鉴权在 API 层：本模块只处理 /auth/*。页面（登录/设置）是 web/ SPA，不在这里渲染。
// 唯一的服务端 HTML 是 GET /auth/verify 的确认页（防邮件安全网关预取一次性 token，见 design §3.1）。

import type { Env } from '../types';
import { MAGIC_LINK_TTL } from '../config';
import { checkRateLimit, RULES } from '../gateway/rate-limiter';
import { sendMagicLinkEmail } from '../services/mail';
import {
  createSession, destroySession, parseSessionToken, buildSessionCookie, clearSessionCookie,
} from '../services/session';
import {
  getUserByEmail, getUserById, createUser, updateUserLastLogin, bindTelegramToUser,
} from '../database';

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
<title>确认登录 · Moto Bot</title>${STYLE}</head>
<body><div class="card">
<h1>🏍 确认登录 Moto Bot</h1>
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
<title>确认绑定 · Moto Bot</title>${STYLE}</head>
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

  try {
    await bindTelegramToUser(env.DB, rec.email, rec.telegram_id);   // 含账号合并（情形 B）
  } catch (e) {
    return html(400, page('绑定失败', e instanceof Error ? e.message : '绑定失败，请稍后重试。'));
  }

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
<title>${escapeHtml(title)} · Moto Bot</title>${STYLE}</head>
<body><div class="card"><h1>🏍 ${escapeHtml(title)}</h1><p>${escapeHtml(msg)}</p></div></body></html>`;
}
