// Telegram 渠道适配器：把 grammY Context 适配为 ChannelAdapter 接口。
// 按每次请求构造（ctx 在构造函数中注入），适合 webhook 模式。
// Reply Keyboard（菜单栏）在 /start 或 /lang 切换时推送一次，持久常驻，
// 不再每条回复挂内联按钮（spec 019 UX 优化）。

import { type Context, Keyboard } from 'grammy';
import type { ChannelAdapter } from '../../ports';
import type { Lang } from '../../i18n/types';
import type { Env } from '../../types';
import { getLang, setLang, detectLang, t } from '../../i18n';

export class TelegramAdapter implements ChannelAdapter {
  private chatId: string;
  private lang: Lang | null = null;

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
    // Reply Keyboard 在 /start 时推送后持久常驻，不用每条都带
    return this.ctx.reply(text);
  }

  /** 从 KV 或 Telegram language_code 检测用户语言偏好（结果缓存到实例，省重复 KV 读） */
  async detectLanguage(): Promise<Lang> {
    if (this.lang) return this.lang;
    let lang = await getLang(this.env.SESSION_KV, this.chatId);
    if (!lang && this.ctx.from?.language_code) {
      lang = detectLang(this.ctx.from.language_code);
      await setLang(this.env.SESSION_KV, this.chatId, lang);
    }
    this.lang = lang ?? 'zh';
    return this.lang;
  }

  /** 发送"思考中…"占位消息，返回消息 ID 用于后续 replaceReply 替换 */
  async sendPrelude(lang: Lang): Promise<string> {
    const msg = await this.ctx.api.sendMessage(this.chatId, '🤔 思考中…');
    return String(msg.message_id);
  }

  /** 将之前发送的"思考中…"替换为最终回复 */
  async replaceReply(preludeId: string, text: string, lang: Lang): Promise<unknown> {
    return this.ctx.api.editMessageText(this.chatId, Number(preludeId), text);
  }
}

/** 按语言构建 Reply Keyboard（菜单栏，常驻输入框上方）—— 导出供 index.ts 复用 */
export function buildKeyboard(lang: Lang): Keyboard {
  const langBtn = lang === 'zh' ? 'button.lang_to_en' : 'button.lang_to_zh';
  return new Keyboard()
    .text(t('button.stats', lang)).text(t('button.last', lang))
    .row()
    .text(t('button.dashboard', lang)).text(t(langBtn, lang))
    .resized();
}
