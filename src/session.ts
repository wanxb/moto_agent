import { Env, Message } from './types';
import { agentLoop } from './agent';

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

  let reply: string;
  try {
    reply = await agentLoop(messages, env);
  } catch (e) {
    console.error('[agent] error:', e);
    reply = '出错了，请稍后重试。';
  }

  const trimmed = messages.slice(-MAX_SESSION_MESSAGES);
  await env.SESSION_KV.put(key, JSON.stringify(trimmed), { expirationTtl: SESSION_TTL });

  await ctx.reply(reply);
}
