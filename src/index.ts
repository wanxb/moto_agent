import { Bot, webhookCallback } from 'grammy';
import { Env } from './types';
import { runAgent } from './session';
import { runScheduled } from './scheduled';
import { transcribe } from './stt';
import { bootstrap } from './bootstrap';
import { RestAdapter } from './gateway/adapters/rest';
import { MAX_VOICE_SECONDS } from './config';
import { handleApiRequest } from './routes/api';
import { dashboardPage } from './routes/dashboard-html';

const WELCOME = `👋 摩托车油耗管理助手

直接发消息记录加油或查询统计，例如：
• 刚加了 10 升 95 号，花了 98 块，里程 12580
• 查一下最近 3 个月油耗
• 上次什么时候加的油

命令：/stats 本月统计  /last 最近记录  /help 帮助`;

const HELP = `📖 使用方法

记录加油：说出加油信息即可
  "今天加了 10 升，花了 98，里程 12580"

查询油耗：
  "最近 3 个月油耗"  "本月统计"  "最近 5 次"

快捷命令：
  /stats  本月油耗统计
  /last   最近一次加油记录`;

function createBot(env: Env): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Access control middleware
  bot.use(async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    if (env.ALLOWED_CHAT_ID && chatId !== env.ALLOWED_CHAT_ID) {
      await ctx.reply('抱歉，无访问权限。');
      return;
    }
    await next();
  });

  bot.command('start', ctx => ctx.reply(WELCOME));
  bot.command('help',  ctx => ctx.reply(HELP));

  bot.command('last',  ctx => runAgent(ctx.chat.id.toString(), '获取最近一次加油记录', env, ctx));
  bot.command('stats', ctx => runAgent(ctx.chat.id.toString(), '查询本月油耗统计', env, ctx));

  // Dashboard 快捷链接 — token 由服务端自动注入，点击即可查看
  bot.command('dashboard', ctx => {
    const url = env.DASHBOARD_URL;
    if (!url) return ctx.reply('⚠️ 未配置 Dashboard 地址，请联系管理员设置 DASHBOARD_URL。');
    return ctx.reply('📊 <a href="' + url + '">打开 Moto Agent Dashboard</a>', { parse_mode: 'HTML' });
  });

  bot.on('message:text', ctx =>
    runAgent(ctx.chat.id.toString(), ctx.message.text, env, ctx)
  );

  // 语音输入（spec 008）：转文字后走与打字完全相同的链路
  bot.on('message:voice', async ctx => {
    const chatId = ctx.chat.id.toString();
    const voice = ctx.message.voice;

    if (voice.duration > MAX_VOICE_SECONDS) {
      await ctx.reply(`语音有点长（${voice.duration}s），请控制在 ${MAX_VOICE_SECONDS} 秒内，或直接打字。`);
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
      text = await transcribe(bytes, env);
    } catch (e) {
      console.error('[voice] stt error:', e instanceof Error ? e.message : String(e));
      await ctx.reply('语音识别失败，请再说一遍或直接打字。');
      return;
    }

    console.log(`[voice] duration=${voice.duration} chars=${text.length}`);
    if (!text) {
      await ctx.reply('没听清，请再说一遍或直接打字。');
      return;
    }

    await ctx.reply(`🎙 听到：${text}`);
    await runAgent(chatId, text, env, ctx);
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
            return new Response(JSON.stringify({ error: '缺少 text' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          }
          const app = bootstrap(env);
          const adapter = new RestAdapter(app.allowedChatId);
          const raw = { headers: request.headers, body };
          const reply = await app.run(adapter, raw);
          return new Response(JSON.stringify({ reply }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch (e) {
          console.error('[api] chat error:', e instanceof Error ? e.message : String(e));
          return new Response(JSON.stringify({ error: '处理失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
      }

      // ── Dashboard HTML ────────────────────────────────────────────────────
      if (url.pathname === '/dashboard' || url.pathname === '/dashboard/') {
        // Token 从 ALLOWED_CHAT_ID 自动注入，URL 无需携带
        const token = env.ALLOWED_CHAT_ID || '';
        return new Response(dashboardPage(token), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
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
      // Verify Telegram webhook secret
      if (env.TELEGRAM_WEBHOOK_SECRET) {
        const token = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
        if (token !== env.TELEGRAM_WEBHOOK_SECRET) {
          return new Response('Unauthorized', { status: 401 });
        }
      }

      const bot = createBot(env);
      const handle = webhookCallback(bot, 'cloudflare-mod');
      return handle(request);
    } catch (e) {
      console.error('[worker] unhandled error:', e instanceof Error ? e.stack : String(e));
      return new Response('Internal Server Error', { status: 500 });
    }
  },

  // Cron Triggers 入口（spec 003 定时提醒）：每日扫描到期提醒并主动推送。
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runScheduled(env).catch(e =>
        console.error('[cron] runScheduled error:', e instanceof Error ? e.stack : String(e))
      )
    );
  },
};
