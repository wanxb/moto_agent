// Workers AI 向量化函数（spec 015 知识库 RAG）。
// 使用 @cf/baai/bge-m3 模型，输出 1024 维向量。

import type { Env } from '../types';
import { EMBEDDING_TIMEOUT_MS } from '../config';

const EMBEDDING_MODEL = '@cf/baai/bge-m3';

/**
 * 对文本进行向量化。返回 1024 维 float 数组。
 * 超时保护：Workers AI 冷启动可能耗时 10-30s，超时则抛错让调用方降级。
 * @throws 如果 AI 调用失败或超时
 */
export async function embed(text: string, ai: Env['AI']): Promise<number[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      ai.run(EMBEDDING_MODEL, { text: [text] }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Embedding timed out')), EMBEDDING_TIMEOUT_MS);
      }),
    ]) as { data: number[][] };
    return result.data[0];
  } finally {
    if (timer) clearTimeout(timer);
  }
}
