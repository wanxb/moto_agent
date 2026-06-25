// 按「完整回合」截断会话历史（spec 007）。
// 独立于 session.ts 供 pipeline.ts 等模块使用。

import type { Message } from '../types';

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
