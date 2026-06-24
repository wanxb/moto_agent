// Cloudflare KV 会话存储（spec 007 回合截断仍在上层 session.ts 负责）。

import type { ISessionStore } from '../ports';
import type { Message } from '../types';

export class CFKVSession implements ISessionStore {
  constructor(private kv: KVNamespace) {}

  private key(userId: string): string { return `session:${userId}`; }

  async get(userId: string): Promise<Message[]> {
    const raw = await this.kv.get(this.key(userId));
    return raw ? (JSON.parse(raw) as Message[]) : [];
  }

  async set(userId: string, messages: Message[], ttl: number): Promise<void> {
    await this.kv.put(this.key(userId), JSON.stringify(messages), { expirationTtl: ttl });
  }
}
