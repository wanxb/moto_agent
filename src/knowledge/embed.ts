// Workers AI 向量化函数（spec 015 知识库 RAG）。
// 使用 @cf/baai/bge-m3 模型，输出 1024 维向量。

import type { Env } from '../types';

const EMBEDDING_MODEL = '@cf/baai/bge-m3';

/**
 * 对文本进行向量化。返回 1024 维 float 数组。
 * @throws 如果 AI 调用失败
 */
export async function embed(text: string, ai: Env['AI']): Promise<number[]> {
  const result = await ai.run(EMBEDDING_MODEL, {
    text: [text],
  }) as { data: number[][] };

  return result.data[0];
}
