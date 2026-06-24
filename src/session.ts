import { Env, Message } from './types';
import { agentLoop } from './agent';
import { toPlainText } from './format';
import { SESSION_TTL, MAX_SESSION_MESSAGES } from './config';
import type { Lang } from './i18n/types';
import { getLang, setLang, detectLang, t } from './i18n';

export { MAX_SESSION_MESSAGES } from './config';

// 按「完整回合」截断会话历史
export function trimHistory(messages: Message[], maxMessages: number): Message[] {
  if (messages.length <= maxMessages && (messages.length === 0 || messages[0].role === 'user')) {
    return messages;
  }
  const userIdxs = messages.reduce<number[]>((acc, m, i) => {
    if (m.role === 'user') acc.push(i);
    return acc;
  }, []);
  if (userIdxs.length === 0) return messages.slice(-maxMessages);
  const start = userIdxs.find(i => messages.length - i <= maxMessages) ?? userIdxs[userIdxs.length - 1];
  return messages.slice(start);
}

export async function runAgent(
  chatId: string,
  userText: string,
  env: Env,
  ctx: {
    reply: (text: string) => Promise<unknown>;
    languageCode?: string;  // Telegram ctx.from?.language_code
  }
): Promise<void> {
  const key = `session:${chatId}`;

  // 语言偏好：KV 已有 → 用缓存；否则从 language_code 自动检测
  let lang: Lang = (await getLang(env.SESSION_KV, chatId)) ?? 'zh';
  const kvHadLang = lang !== null;
  if (!kvHadLang && ctx.languageCode) {
    lang = detectLang(ctx.languageCode);
    await setLang(env.SESSION_KV, chatId, lang);
  }

  const raw = await env.SESSION_KV.get(key);
  const messages: Message[] = raw ? (JSON.parse(raw) as Message[]) : [];

  messages.push({ role: 'user', content: userText });

  const t0 = Date.now();
  let reply: string;
  let status = 'ok';
  try {
    reply = await agentLoop(messages, env, lang);
  } catch (e) {
    console.error('[agent] error:', e);
    reply = t('general.fallback_error', lang);
    status = 'error';
  }
  console.log(`[metric] latency_ms=${Date.now() - t0} status=${status} chat=${chatId}`);

  const trimmed = trimHistory(messages, MAX_SESSION_MESSAGES);
  await env.SESSION_KV.put(key, JSON.stringify(trimmed), { expirationTtl: SESSION_TTL });

  await ctx.reply(toPlainText(reply));
}
