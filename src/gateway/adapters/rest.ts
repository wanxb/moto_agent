// REST API 渠道适配器（Phase 3 App/Web Dashboard 用）。
// HTTP Request body: { "text": "...", "userId"?: "..." }
// userId 可从 Header X-User-Id 或 body 取；否则回退 ALLOWED_CHAT_ID。

import type { ChannelAdapter } from '../../ports';

interface RestPayload {
  text?: string;
  userId?: string;
}

export class RestAdapter implements ChannelAdapter {
  constructor(private fallbackUserId?: string) {}

  extractUser(raw: unknown): string {
    // raw 是 { headers: Headers, body: RestPayload }
    const { headers, body } = raw as { headers: Headers; body: RestPayload };
    return body.userId ?? headers.get('X-User-Id') ?? this.fallbackUserId ?? 'anonymous';
  }

  async extractText(raw: unknown): Promise<string> {
    return (raw as { body: RestPayload }).body.text ?? '';
  }

  async reply(_userId: string, _text: string): Promise<unknown> {
    // REST 同步返回 JSON，reply 仅做"不需要单独发消息"的标记
    // pipeline 的返回值由 fetch handler 自己包装成 Response
    return undefined;
  }
}
