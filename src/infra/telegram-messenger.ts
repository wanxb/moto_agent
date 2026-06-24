// Telegram 渠道的消息发送实现（grammY Bot API）。

import { Bot } from 'grammy';
import type { IMessenger } from '../ports';

export class TelegramMessenger implements IMessenger {
  private bot: Bot;

  constructor(token: string) {
    this.bot = new Bot(token);
  }

  /** chat_id → sendMessage。target 是 Telegram chat_id 字符串 */
  async send(target: string, text: string): Promise<unknown> {
    return this.bot.api.sendMessage(Number(target), text);
  }
}
