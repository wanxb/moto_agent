// 消息管道：模板方法，所有渠道共用。将渠道差异关在 ChannelAdapter 里。

import type { ChannelAdapter, ISessionStore } from '../ports';
import type { Message } from '../types';
import { toPlainText } from '../format';
import { trimHistory } from '../session';
import { checkRateLimit, RULES, type RateLimitRule } from './rate-limiter';

// session 配置（当前用 KV TTL 1h + 最多 10 条）
const SESSION_TTL = 3600;
const MAX_SESSION_MESSAGES = 10;

// 轻量 agent 跑手签名：接收消息历史 + DB → 返回最终回复文本
// R2d 之后 agentLoop 签名变为 (messages, llm, registry, db)，这里用统一函数引用
export type AgentRunner = (messages: Message[], db: D1Database) => Promise<string>;

export interface PipelineContext {
  db: D1Database;
  agent: AgentRunner;
  session: ISessionStore;
  kv: KVNamespace;             // 限流复用 SESSION_KV
  rateLimitRule?: RateLimitRule; // 默认用 RULES['chat:per-user']
}

/** 执行一条渠道消息（TTS/Session/Agent/Limit 全包）。返回 agent 的最终回复文本 */
export async function runPipeline(
  adapter: ChannelAdapter,
  raw: unknown,
  ctx: PipelineContext,
): Promise<string | null> {
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

  // 5. 会话 + Agent
  const history = await ctx.session.get(userId);
  history.push({ role: 'user', content: text });

  const reply = await ctx.agent(history, ctx.db);
  const clean = toPlainText(reply);

  // 6. 持久化会话
  const trimmed = trimHistory(history, MAX_SESSION_MESSAGES);
  await ctx.session.set(userId, trimmed, SESSION_TTL);

  // 7. 回复
  await adapter.reply(userId, clean);
  return reply;    // 返回原始文本给 caller 做日志等
}
