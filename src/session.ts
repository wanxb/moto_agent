import { Env, Message } from './types';
import { agentLoop } from './agent';
import { toPlainText } from './format';

const SESSION_TTL = 3600;
export const MAX_SESSION_MESSAGES = 10;

// 按「完整回合」截断会话历史：保留尽量多但 ≤ maxMessages 的消息，且**从 user 消息开始**。
// 这样不会把 assistant 的 tool_calls 与其 tool 结果切散（否则下次请求会出现悬空配对、被模型 API 拒绝）。
export function trimHistory(messages: Message[], maxMessages: number): Message[] {
  if (messages.length <= maxMessages && (messages.length === 0 || messages[0].role === 'user')) {
    return messages;
  }
  const userIdxs = messages.reduce<number[]>((acc, m, i) => {
    if (m.role === 'user') acc.push(i);
    return acc;
  }, []);
  if (userIdxs.length === 0) return messages.slice(-maxMessages); // 无 user 边界，退化
  // 最靠前但仍满足 (len - start) ≤ maxMessages 的 user 边界；都不满足则取最后一个 user（哪怕这一回合超长）
  const start = userIdxs.find(i => messages.length - i <= maxMessages) ?? userIdxs[userIdxs.length - 1];
  return messages.slice(start);
}

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

  const trimmed = trimHistory(messages, MAX_SESSION_MESSAGES);
  await env.SESSION_KV.put(key, JSON.stringify(trimmed), { expirationTtl: SESSION_TTL });

  // Telegram 按纯文本显示，清洗掉 LLM 可能产生的 markdown 符号（保留 emoji）
  await ctx.reply(toPlainText(reply));
}
