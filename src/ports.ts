// ── I/O 端口接口（Port）─────────────────────────────────────────────────────
// 定义 core 对外部的依赖：消息发送、LLM 调用、会话存储、语音识别。
// 所有 ChannelAdapter 实现同一种接口，加一个新渠道不改 core。

import type { Message, LLMResponse, ToolDefinition } from './types';

// ── 消息发送 ─────────────────────────────────────────────────────────────────

export interface IMessenger {
  /** 向指定目标发送纯文本。target 由渠道定义（TG: chat_id, 邮箱: email addr） */
  send(target: string, text: string): Promise<unknown>;
}

// ── LLM 调用 ─────────────────────────────────────────────────────────────────

export interface ILLMProvider {
  /** 返回模型回复（文本 + 可能含 tool_calls）。内部已绑定 key/retry/fallback */
  chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse>;
}

// ── 会话存储 ────────────────────────────────────────────────────────────────

export interface ISessionStore {
  get(userId: string): Promise<Message[]>;
  set(userId: string, messages: Message[], ttl: number): Promise<void>;
}

// ── 语音转文字 ───────────────────────────────────────────────────────────────

export interface ITTSProvider {
  /** 返回识别出的纯文本 */
  transcribe(audioBytes: Uint8Array): Promise<string>;
}

// ── 渠道适配器（gateway pipeline 用）─────────────────────────────────────────
// 一个渠道 = 如何取用户 ID + 如何取文本 + 如何回复。可选：预处理钩子 + 鉴权。

export interface ChannelAdapter {
  /** 从渠道原始消息中提取用户标识 */
  extractUser(raw: unknown): string;
  /** 从渠道原始消息中提取/转写为纯文本 */
  extractText(raw: unknown): Promise<string>;
  /** 向该渠道的用户发回回复 */
  reply(userId: string, text: string): Promise<unknown>;
  /** 可选：在 pipeline 之前做渠道特有鉴权，失败抛错 */
  authenticate?(raw: unknown): Promise<void> | void;
}
