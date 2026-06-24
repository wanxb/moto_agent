// Telegram 渠道适配器：把 grammY Context 适配为 ChannelAdapter 接口。

import type { Context } from 'grammy';
import type { ChannelAdapter, IMessenger, ITTSProvider } from '../../ports';
import { MAX_VOICE_SECONDS } from '../../config';

export class TelegramAdapter implements ChannelAdapter {
  constructor(
    private messenger: IMessenger,
    private stt: ITTSProvider,
    private botToken: string,
    private allowedChatId?: string,
  ) {}

  // ── ChannelAdapter 实现 ──────────────────────────────────────────────────

  extractUser(raw: unknown): string {
    // raw 是 grammy Context，内部 cast 不污染接口
    const ctx = raw as Context;
    return ctx.chat!.id.toString();
  }

  async extractText(raw: unknown): Promise<string> {
    const ctx = raw as Context;

    // 语音消息
    if (ctx.message?.voice) {
      const voice = ctx.message.voice;
      if (voice.duration > MAX_VOICE_SECONDS) {
        throw new VoiceError(`语音有点长（${voice.duration}s），请控制在 ${MAX_VOICE_SECONDS} 秒内，或直接打字。`);
      }
      const file = await ctx.getFile();
      if (!file.file_path) throw new VoiceError('语音文件不可用');
      const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
      const res = await fetch(url);
      if (!res.ok) throw new VoiceError('语音下载失败');
      const bytes = new Uint8Array(await res.arrayBuffer());
      return this.stt.transcribe(bytes);
    }

    // 文本消息
    if (ctx.message?.text) return ctx.message.text;

    return '';
  }

  async reply(userId: string, text: string): Promise<unknown> {
    return this.messenger.send(userId, text);
  }

  async authenticate(raw: unknown): Promise<void> {
    if (!this.allowedChatId) return;
    const ctx = raw as Context;
    const chatId = ctx.chat?.id?.toString();
    if (chatId !== this.allowedChatId) {
      throw new AuthError('无访问权限');
    }
  }
}

// 渠道特有错误：上层 index.ts 需要识别并回对应的用户消息
export class VoiceError extends Error { name = 'VoiceError'; }
export class AuthError extends Error { name = 'AuthError'; }
