import { Env, Message } from './types';
import { agentLoop } from './agent';
import { toPlainText } from './format';

const SESSION_TTL = 3600;
export const MAX_SESSION_MESSAGES = 10;

export async function runAgent(
  chatId: string,
  userText: string,
  env: Env,
  ctx: { reply: (text: string) => Promise<unknown> }
): Promise<void> {
  const key = `session:${chatId}`;

  const raw = await env.SESSION_KV.get(key);
  const messages: Message[] = raw ? (JSON.parse(raw) as Message[]) : [];

  messages.push({ role: 'user', content: userText });

  const t0 = Date.now();
  let reply: string;
  let status = 'ok';
  try {
    reply = await agentLoop(messages, env);
  } catch (e) {
    console.error('[agent] error:', e);
    reply = '出错了，请稍后重试。';
    status = 'error';
  }
  // 结构化埋点：端到端延迟 + 成败（spec 006）
  console.log(`[metric] latency_ms=${Date.now() - t0} status=${status} chat=${chatId}`);

  const trimmed = messages.slice(-MAX_SESSION_MESSAGES);
  await env.SESSION_KV.put(key, JSON.stringify(trimmed), { expirationTtl: SESSION_TTL });

  // Telegram 按纯文本显示，清洗掉 LLM 可能产生的 markdown 符号（保留 emoji）
  await ctx.reply(toPlainText(reply));
}
