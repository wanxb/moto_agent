import { Env } from './types';

// 语音转文字（spec 008）。用 Cloudflare Workers AI 的 Whisper（ADR-0007）。
// 模型常量集中此处，便于按需切换到 OpenAI/Groq（接口不变）。
const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

export async function transcribe(bytes: Uint8Array, env: Env): Promise<string> {
  const audio = toBase64(bytes);   // whisper-large-v3-turbo 接收 base64 音频
  const res = await env.AI.run(WHISPER_MODEL, {
    audio,
    task: 'transcribe',
    language: 'zh',
  });
  return ((res as { text?: string }).text ?? '').trim();
}

// 二进制 → base64。分块避免对大数组使用 spread 导致调用栈溢出。
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
