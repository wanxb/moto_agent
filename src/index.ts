import { Bot, webhookCallback, Context } from 'grammy';
import { Env } from './types';
import type { Lang } from './i18n/types';
import { t, setLang, getLang, detectLang } from './i18n';
import { runScheduled } from './scheduled';
import { transcribe } from './stt';
import { bootstrap } from './bootstrap';
import { TelegramAdapter, buildKeyboard } from './gateway/adapters/telegram';
import { RestAdapter } from './gateway/adapters/rest';
import { MAX_VOICE_SECONDS, BIND_LINK_TTL } from './config';
import { handleApiRequest } from './routes/api';
import { handleAuthRequest } from './routes/auth-handler';
import { handleChatRequest } from './routes/chat-api';
import { checkRateLimit, RULES } from './gateway/rate-limiter';
import { sendBindLinkEmail } from './services/mail';
import { signAutoLoginToken } from './services/auto-login';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 站点 origin：WORKER_ORIGIN 优先（保证 KV 一致性），否则 DASHBOARD_URL 的 origin。 */
function siteOrigin(env: Env): string {
  if (env.WORKER_ORIGIN) return env.WORKER_ORIGIN.replace(/\/$/, '');
  if (env.DASHBOARD_URL) { try { return new URL(env.DASHBOARD_URL).origin; } catch { /* ignore */ } }
  return '';
}

function makeWelcome(lang: Lang): string {
  return t('welcome.title', lang) + t('welcome.body', lang);
}
function makeHelp(lang: Lang): string {
  return t('help.title', lang) + t('help.body', lang);
}

/** 从 KV 读取语言偏好，KV 未设置时回退到 Telegram language_code，再回退到 zh */
async function resolveLang(env: Env, chatId: string, languageCode?: string): Promise<Lang> {
  const stored = await getLang(env.SESSION_KV, chatId);
  if (stored) return stored;
  return detectLang(languageCode);
}

/** 统一处理快捷按钮：stats / last / dashboard / lang 切换 */
async function handleStats(env: Env, ctx: Context) {
  const app = bootstrap(env);
  const adapter = new TelegramAdapter(ctx, env);
  const lang = await resolveLang(env, String(ctx.chat!.id), ctx.from?.language_code);
  await app.run(adapter, { text: t('shortcut.stats', lang) });
}
async function handleLast(env: Env, ctx: Context) {
  const app = bootstrap(env);
  const adapter = new TelegramAdapter(ctx, env);
  const lang = await resolveLang(env, String(ctx.chat!.id), ctx.from?.language_code);
  await app.run(adapter, { text: t('shortcut.last', lang) });
}
async function handleDashboard(env: Env, ctx: Context) {
  const origin = siteOrigin(env);
  const chatId = String(ctx.chat!.id);
  const lang = await resolveLang(env, chatId, ctx.from?.language_code);
  const token = await signAutoLoginToken(chatId, env.TELEGRAM_WEBHOOK_SECRET);
  const link = `${origin}/auth/auto-login?t=${encodeURIComponent(token)}`;
  await ctx.reply(t('dashboard.link', lang, link), { parse_mode: 'HTML' });
}
async function handleLangToggle(env: Env, ctx: Context) {
  const chatId = String(ctx.chat!.id);
  const currentLang = await resolveLang(env, chatId, ctx.from?.language_code);
  const newLang: Lang = currentLang === 'zh' ? 'en' : 'zh';
  await setLang(env.SESSION_KV, chatId, newLang);
  const app = bootstrap(env);
  await app.session.clear(chatId);
  const langName = newLang === 'zh' ? '中文' : 'English';
  await ctx.reply(t('lang.switched', newLang, langName));
  await ctx.reply(makeWelcome(newLang), { reply_markup: buildKeyboard(newLang) });
}

function createBot(env: Env): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // ── 命令菜单（点输入框 / 图标可见，Telegram 原生）──
  bot.api.setMyCommands([
    { command: 'stats',     description: '📊 本月油耗统计' },
    { command: 'last',      description: '🕐 最近一次加油' },
    { command: 'dashboard', description: '📊 打开 Dashboard' },
    { command: 'lang',      description: '🌐 切换语言' },
    { command: 'help',      description: '📖 使用方法' },
  ]).catch(e => console.error('[setup] setMyCommands error:', e));

  // 诊断日志：记录所有 update 类型
  bot.use(async (ctx, next) => {
    const types = Object.keys(ctx.update).filter(k => k !== 'update_id');
    console.log('[update] types=', types.join(','));
    await next();
  });

  // 开放自助（spec 016 修订）：去掉 ALLOWED_CHAT_ID 白名单门控，任何 TG 用户均可使用。
  // 用户首次发消息时由管道 resolveUserId 自动建号，数据按 user_id 隔离；成本由每用户限流兜底。
  // 端点本身仍受 webhook secret 保护。

  bot.command('start', async ctx => {
    const lang = await resolveLang(env, ctx.chat!.id.toString(), ctx.from?.language_code);
    // 首次使用时推送 Reply Keyboard（菜单栏，常驻输入框上方）
    await ctx.reply(makeWelcome(lang), { reply_markup: buildKeyboard(lang) });
  });
  bot.command('help', async ctx => {
    const lang = await resolveLang(env, ctx.chat!.id.toString(), ctx.from?.language_code);
    await ctx.reply(makeHelp(lang));
  });

  bot.command('last',  ctx => handleLast(env, ctx));
  bot.command('stats', ctx => handleStats(env, ctx));

  // spec 010: 语言切换命令
  bot.command('lang', async ctx => {
    const chatId = ctx.chat.id.toString();
    const arg = ctx.message?.text?.split(/\s+/)[1]?.toLowerCase();
    if (arg === 'zh' || arg === 'en') {
      await setLang(env.SESSION_KV, chatId, arg);
      const app = bootstrap(env);
      await app.session.clear(chatId);
      const langName = arg === 'zh' ? '中文' : 'English';
      await ctx.reply(t('lang.switched', arg, langName), { reply_markup: buildKeyboard(arg) });
      await ctx.reply(makeWelcome(arg));
    } else {
      const lang = await resolveLang(env, chatId, ctx.from?.language_code);
      await ctx.reply(t('lang.unknown', lang));
    }
  });

  bot.command('dashboard', ctx => handleDashboard(env, ctx));

  // spec 016: 账号绑定（仅在 Telegram 内发起）。输入邮箱 → 发验证链接 → 点击即把本 TG 账号数据并入该邮箱账号。
  // PWA 完全不感知此流程；纯 PWA 用户无需知道 Telegram 的存在。
  bot.command('bind', async ctx => {
    const chatId = ctx.chat.id.toString();
    const lang = await resolveLang(env, chatId, ctx.from?.language_code);
    const email = ctx.message?.text?.split(/\s+/)[1]?.trim().toLowerCase() ?? '';
    if (!EMAIL_RE.test(email)) {
      await ctx.reply(t('bind.usage', lang));
      return;
    }
    const origin = siteOrigin(env);
    if (!origin) {
      await ctx.reply(t('bind.mail_failed', lang));   // 没配站点地址，拼不出链接
      return;
    }
    // 无 IP，用 chatId 做限流键，防验证邮件轰炸
    const rl = await checkRateLimit(env.SESSION_KV, `auth:bind:${email}:${chatId}`, RULES['auth:send']);
    if (!rl.allowed) {
      await ctx.reply(t('bind.rate_limited', lang));
      return;
    }
    // 链接式：token 关联 {email, telegram_id}，点击后 get-or-create 邮箱账号并合并 TG 数据。
    const token = crypto.randomUUID();
    const expiresAt = Math.floor(Date.now() / 1000) + BIND_LINK_TTL;
    await env.SESSION_KV.put(
      `bind_link:${token}`,
      JSON.stringify({ email, telegram_id: chatId, expiresAt }),
      { expirationTtl: BIND_LINK_TTL },
    );
    try {
      await sendBindLinkEmail(env, email, `${origin}/auth/bind?token=${token}`);
    } catch (e) {
      console.error('[bind] mail error:', e instanceof Error ? e.message : String(e));
      await ctx.reply(t('bind.mail_failed', lang));
      return;
    }
    await ctx.reply(t('bind.link_sent', lang, email));
  });

  // ── Reply Keyboard 按钮文字拦截（点菜单栏按钮 = 发送对应文字）──

  bot.hears(t('button.stats', 'zh'),     ctx => handleStats(env, ctx));
  bot.hears(t('button.stats', 'en'),     ctx => handleStats(env, ctx));
  bot.hears(t('button.last', 'zh'),      ctx => handleLast(env, ctx));
  bot.hears(t('button.last', 'en'),      ctx => handleLast(env, ctx));
  bot.hears(t('button.dashboard', 'zh'), ctx => handleDashboard(env, ctx));
  bot.hears(t('button.dashboard', 'en'), ctx => handleDashboard(env, ctx));
  bot.hears(t('button.lang_to_en', 'zh'), ctx => handleLangToggle(env, ctx));
  bot.hears(t('button.lang_to_zh', 'en'), ctx => handleLangToggle(env, ctx));

  bot.on('message:text', async ctx => {
    try {
      const app = bootstrap(env);
      const adapter = new TelegramAdapter(ctx, env);
      await app.run(adapter, { text: ctx.message!.text ?? '' });
    } catch (e) {
      console.error('[tg] message:text fatal:', e instanceof Error ? e.stack : String(e));
      // pipeline.ts 已有内部 try/catch，能兜住 agent 运行时异常；
      // 此处兜底 bootstrap 或极早期错误，确保用户不会被静默吞掉
      try {
        await ctx.reply('⚠️ 暂时处理不了，稍后再试试吧。');
      } catch { /* 静默 */ }
    }
  });

  // 语音输入（spec 008）：转文字后走与打字完全相同的链路
  bot.on('message:voice', async ctx => {
    const chatId = ctx.chat.id.toString();
    const voice = ctx.message.voice;
    const lang = await resolveLang(env, chatId, ctx.from?.language_code);

    if (voice.duration > MAX_VOICE_SECONDS) {
      await ctx.reply(t('voice.too_long', lang, String(voice.duration), String(MAX_VOICE_SECONDS)));
      return;
    }

    let text: string;
    try {
      const file = await ctx.getFile();
      if (!file.file_path) throw new Error('no file_path');
      const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const audioRes = await fetch(url);
      if (!audioRes.ok) throw new Error(`download ${audioRes.status}`);
      const bytes = new Uint8Array(await audioRes.arrayBuffer());
      text = await transcribe(bytes, env, lang);
    } catch (e) {
      console.error('[voice] stt error:', e instanceof Error ? e.message : String(e));
      await ctx.reply(t('voice.stt_failed', lang));
      return;
    }

    console.log(`[voice] duration=${voice.duration} chars=${text.length}`);
    if (!text) {
      await ctx.reply(t('general.no_voice_text', lang));
      return;
    }

    await ctx.reply(t('voice.heard', lang, text));
    const app = bootstrap(env);
    const adapter = new TelegramAdapter(ctx, env);
    await app.run(adapter, { text });
  });

  return bot;
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      // ── REST API（Phase 3 App/Web/Dashboard）─────────────────────────────────
      if (url.pathname === '/api/v1/chat' && request.method === 'POST') {
        try {
          const body = await request.json() as { text?: string; userId?: string };
          if (!body.text) {
            return new Response(JSON.stringify({ error: t('general.api_no_text', 'en') }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          }
          const app = bootstrap(env);
          const adapter = new RestAdapter(app.allowedChatId);
          const raw = { headers: request.headers, body };
          const reply = await app.run(adapter, raw);
          return new Response(JSON.stringify({ reply }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
          console.error('[api] chat error:', e instanceof Error ? e.message : String(e));
          return new Response(JSON.stringify({ error: t('general.api_error', 'en') }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      // Dashboard 已迁入 web/ SPA（Dashboard.svelte），由下方 [assets] 在 /dashboard 提供。

      // ── Debug ping ─────────────────────────────────────────────────────────
      if (url.pathname === '/ping') {
        return new Response('pong ' + (env.ALLOWED_CHAT_ID ? 'ok' : 'no-token'), { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }

      // ── Dashboard / 用户 API ──────────────────────────────────────────────
      // 只读端点走 GET；/api/v1/me 额外支持 POST（更新语言偏好，session 鉴权）。
      if (url.pathname.startsWith('/api/v1/') &&
          (request.method === 'GET' || (url.pathname === '/api/v1/me' && request.method === 'POST'))) {
        return handleApiRequest(request, env);
      }

      // ── 认证路由（spec 016：Magic Link / 登出 / 绑定）─────────────────────
      if (url.pathname.startsWith('/auth/')) {
        return handleAuthRequest(request, env);
      }

      // ── PWA 对话（spec 016）──────────────────────────────────────────────
      if (url.pathname === '/chat/api' || url.pathname === '/chat/voice') {
        return handleChatRequest(request, env);
      }

      // ── 一次性：修复 webhook allowed_updates（加 callback_query）────────────
      if (url.pathname === '/setup-webhook') {
        const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
        try {
          const info = await bot.api.getWebhookInfo();
          const hookUrl = info.url || url.origin + '/telegram-webhook';
          const result = await bot.api.setWebhook(hookUrl, {
            secret_token: env.TELEGRAM_WEBHOOK_SECRET,
            allowed_updates: ['message'],
          });
          return new Response(JSON.stringify({ ok: true, was: info.allowed_updates, now: result }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (e) {
          return new Response(JSON.stringify({ ok: false, error: String(e) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // ── 静态资源 / SPA（spec 016 / ADR-0010）──────────────────────────────
      // 动态路由（上面）已先行处理；其余 GET 交给 [assets]（SPA fallback 到 index.html）。
      // 测试环境无 ASSETS 绑定（wrangler.test.toml 未配），跳过以保留原行为。
      if (env.ASSETS && request.method === 'GET') {
        return env.ASSETS.fetch(request);
      }

      // ── Telegram webhook ──────────────────────────────────────────────────
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const token = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
        if (token !== env.TELEGRAM_WEBHOOK_SECRET) {
          return new Response('Unauthorized', { status: 401 });
        }
      }

      const bot = createBot(env);
      // 超时 25 秒（部分查询需多次 LLM 调用 >10s）
      const handle = webhookCallback(bot, 'cloudflare-mod', 'throw', 25_000);

      // grammY webhook 内未捕获的错误兜底
      try {
        const res = await handle(request);
        console.log('[webhook] response status:', res.status);
        return res;
      } catch (e) {
        const msg = e instanceof Error ? e.stack : String(e);
        console.error('[webhook] grammY error:', msg);
        return new Response(msg, { status: 200 });
      }
    } catch (e) {
      console.error('[worker] unhandled error:', e instanceof Error ? e.stack : String(e));
      return new Response('Internal Server Error', { status: 500 });
    }
  },

  // Cron Triggers 入口（spec 003 定时提醒）
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runScheduled(env).catch(e =>
        console.error('[cron] runScheduled error:', e instanceof Error ? e.stack : String(e))
      )
    );
  },
};
