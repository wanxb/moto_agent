// Telegram 渠道适配器：把 grammY Context 适配为 ChannelAdapter 接口。
// 按每次请求构造（ctx 在构造函数中注入），适合 webhook 模式。

import type { Context } from 'grammy';
import type { ChannelAdapter } from '../../ports';
import type { Lang } from '../../i18n/types';
import type { Env } from '../../types';
import { getLang, setLang, detectLang } from '../../i18n';

export class TelegramAdapter implements ChannelAdapter {
  private chatId: string;

  constructor(
    private ctx: Context,
    private env: Env,
  ) {
    this.chatId = String(ctx.chat!.id);
  }

  extractUser(_raw: unknown): string {
    return this.chatId;
  }

  async extractText(raw: unknown): Promise<string> {
    return (raw as { text: string }).text ?? '';
  }

  async reply(_userId: string, text: string): Promise<unknown> {
    return this.ctx.reply(text);
  }

  /** 从 KV 或 Telegram language_code 检测用户语言偏好 */
  async detectLanguage(): Promise<Lang> {
    let lang = await getLang(this.env.SESSION_KV, this.chatId);
    if (!lang && this.ctx.from?.language_code) {
      lang = detectLang(this.ctx.from.language_code);
      await setLang(this.env.SESSION_KV, this.chatId, lang);
    }
    return lang ?? 'zh';
  }
}
