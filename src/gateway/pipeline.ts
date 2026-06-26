// 消息管道：模板方法，所有渠道共用。将渠道差异关在 ChannelAdapter 里。

import type { ChannelAdapter, ISessionStore } from '../ports';
import type { Message } from '../types';
import type { Lang } from '../i18n/types';
import { t } from '../i18n';
import { toPlainText } from '../format';
import { trimHistory } from '../session-store/trim-history';
import { checkRateLimit, RULES, type RateLimitRule } from './rate-limiter';
import { SESSION_TTL, MAX_SESSION_MESSAGES } from '../config';

// 轻量 agent 跑手签名：接收消息历史 + DB + 语言 + 当前用户 id（spec 016）→ 返回最终回复文本
export type AgentRunner = (messages: Message[], db: D1Database, lang?: Lang, userId?: number) => Promise<string>;

export interface PipelineContext {
  db: D1Database;
  agent: AgentRunner;
  session: ISessionStore;
  kv: KVNamespace;             // 限流复用 SESSION_KV
  rateLimitRule?: RateLimitRule; // 默认用 RULES['chat:per-user']
  // 渠道用户标识（如 TG chat_id）→ DB users.id。提供时数据按 user_id 隔离；
  // 不提供（如旧单用户路径）则传 undefined，沿用不过滤行为。
  resolveUserId?: (channelUser: string, lang: Lang) => Promise<number | undefined>;
}

/** 执行一条渠道消息（语言检测/限流/Session/Agent/持久化/回复全包）。返回 agent 的最终回复文本 */
export async function runPipeline(
  adapter: ChannelAdapter,
  raw: unknown,
  ctx: PipelineContext,
): Promise<string | null> {
  const t0 = Date.now();
  let status = 'ok';
  let reply = '';

  try {
    // 1. 提取用户
    const userId = adapter.extractUser(raw);

    // 2. 限流（保护最贵的资源——LLM 调用）
    const rule = ctx.rateLimitRule ?? RULES['chat:per-user'];
    const limit = await checkRateLimit(ctx.kv, `rate:user:${userId}:chat`, rule);
    if (!limit.allowed) {
      const wait = limit.resetAt - Math.floor(Date.now() / 1000);
      await adapter.reply(userId, `消息有点频繁，请等 ${wait} 秒再发 🕐`);
      return null;
    }

    // 3. 渠道鉴权（可选）
    if (adapter.authenticate) await adapter.authenticate(raw);

    // 4. 提取文本
    const text = await adapter.extractText(raw);
    if (!text) {
      await adapter.reply(userId, '没听清，请再说一遍或直接打字。');
      return null;
    }

    // 4.5 语言检测（可选）
    let lang: Lang = 'zh';
    if (adapter.detectLanguage) {
      lang = await adapter.detectLanguage();
    }

    // 5. 会话 + Agent（解析当前用户 → 注入 user_id 实现数据隔离）
    const dbUserId = ctx.resolveUserId ? await ctx.resolveUserId(userId, lang) : undefined;
    const history = await ctx.session.get(userId);
    history.push({ role: 'user', content: text });

    reply = await ctx.agent(history, ctx.db, lang, dbUserId);
    const clean = toPlainText(reply);

    // 6. 持久化会话
    const trimmed = trimHistory(history, MAX_SESSION_MESSAGES);
    await ctx.session.set(userId, trimmed, SESSION_TTL);

    // 7. 回复
    await adapter.reply(userId, clean);
  } catch (e) {
    status = 'error';
    console.error('[pipeline] error:', e instanceof Error ? e.message : String(e));
    // 尝试回复用户统一错误提示（reply 失败则静默）
    try {
      const lang: Lang = adapter.detectLanguage ? await adapter.detectLanguage() : 'zh';
      await adapter.reply('', t('general.fallback_error', lang));
    } catch { /* 静默 */ }
  }

  console.log(`[metric] latency_ms=${Date.now() - t0} status=${status}`);
  return reply || null;
}
