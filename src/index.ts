import { Bot, webhookCallback } from 'grammy';
import { Env } from './types';
import { runAgent } from './session';
import { runScheduled } from './scheduled';

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

  bot.on('message:text', ctx =>
    runAgent(ctx.chat.id.toString(), ctx.message.text, env, ctx)
  );

  return bot;
}


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
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
