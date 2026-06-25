import { Bot, webhookCallback } from 'grammy';
import { Env } from './types';
import type { Lang } from './i18n/types';
import { t, setLang, getLang, detectLang } from './i18n';
import { runScheduled } from './scheduled';
import { transcribe } from './stt';
import { bootstrap } from './bootstrap';
import { TelegramAdapter } from './gateway/adapters/telegram';
import { RestAdapter } from './gateway/adapters/rest';
import { MAX_VOICE_SECONDS } from './config';
import { handleApiRequest } from './routes/api';
import { dashboardPage } from './routes/dashboard-html';

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

function createBot(env: Env): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Access control middleware
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    if (env.ALLOWED_CHAT_ID && chatId !== env.ALLOWED_CHAT_ID) {
      const langCode = ctx.from?.language_code;
      const lang: Lang = langCode?.startsWith('zh') ? 'zh' : 'en';
      await ctx.reply(t('general.authorized_only', lang));
      return;
    }
    await next();
  });

  bot.command('start', async ctx => {
    const lang = await resolveLang(env, ctx.chat!.id.toString(), ctx.from?.language_code);
    await ctx.reply(makeWelcome(lang));
  });
  bot.command('help', async ctx => {
    const lang = await resolveLang(env, ctx.chat!.id.toString(), ctx.from?.language_code);
    await ctx.reply(makeHelp(lang));
  });

  bot.command('last', async ctx => {
    const app = bootstrap(env);
    const adapter = new TelegramAdapter(ctx, env);
    const lang = await resolveLang(env, ctx.chat!.id.toString(), ctx.from?.language_code);
    await app.run(adapter, { text: t('shortcut.last', lang) });
  });
  bot.command('stats', async ctx => {
    const app = bootstrap(env);
    const adapter = new TelegramAdapter(ctx, env);
    const lang = await resolveLang(env, ctx.chat!.id.toString(), ctx.from?.language_code);
    await app.run(adapter, { text: t('shortcut.stats', lang) });
  });

  // spec 010: 语言切换命令
  bot.command('lang', async ctx => {
    const chatId = ctx.chat.id.toString();
    const arg = ctx.message?.text?.split(/\s+/)[1]?.toLowerCase();
    if (arg === 'zh' || arg === 'en') {
      await setLang(env.SESSION_KV, chatId, arg);
      // 切换语言时清空会话历史，防止旧历史干扰新语言
      const app = bootstrap(env);
      await app.session.clear(chatId);
      await ctx.reply(t('lang.switched', arg, arg === 'zh' ? '中文' : 'English'));
    } else {
      const lang = await resolveLang(env, chatId, ctx.from?.language_code);
      await ctx.reply(t('lang.unknown', lang));
    }
  });

  bot.command('dashboard', async ctx => {
    const url = env.DASHBOARD_URL;
    if (!url) {
      const lang = await resolveLang(env, ctx.chat!.id.toString(), ctx.from?.language_code);
      return ctx.reply(t('dashboard.no_url', lang));
    }
    // dashboard 用用户当前语言展示链接
    const lang = await resolveLang(env, ctx.chat!.id.toString(), ctx.from?.language_code);
    return ctx.reply(t('dashboard.link', lang, url), { parse_mode: 'HTML' });
  });

  bot.on('message:text', async ctx => {
    const app = bootstrap(env);
    const adapter = new TelegramAdapter(ctx, env);
    await app.run(adapter, { text: ctx.message!.text ?? '' });
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

      // ── Dashboard HTML ────────────────────────────────────────────────────
      if (url.pathname === '/dashboard' || url.pathname === '/dashboard/') {
        const token = env.ALLOWED_CHAT_ID || '';
        const lang = url.searchParams.get('lang') || undefined;
        return new Response(dashboardPage(token, lang), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' } });
      }

      // ── Debug ping ─────────────────────────────────────────────────────────
      if (url.pathname === '/ping') {
        return new Response('pong ' + (env.ALLOWED_CHAT_ID ? 'ok' : 'no-token'), { status: 200, headers: { 'Content-Type': 'text/plain' } });
      }

      // ── Dashboard API (read-only, token auth) ─────────────────────────────
      if (url.pathname.startsWith('/api/v1/') && request.method === 'GET') {
        return handleApiRequest(request, env);
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
        return await handle(request);
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
