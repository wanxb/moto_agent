// 知识库搜索工具（spec 015）。嵌入 RAG 检索到现有 Agent Loop 中。

import type { Tool } from './interface';
import type { Lang } from '../i18n/types';
import type { Env } from '../types';
import { embed } from '../knowledge/embed';
import { getChunksById } from '../database';
import { t } from '../i18n';
import { VECTORIZE_QUERY_TIMEOUT_MS } from '../config';

export class SearchKnowledgeTool implements Tool {
  readonly name = 'search_knowledge';
  readonly description = '搜索摩托车维修和保养知识库。用户问专业保养/维修/故障问题时调用。';
  readonly descriptionEn = 'Search the motorcycle maintenance knowledge base. Call when user asks repair/maintenance/troubleshooting questions.';
  readonly parameters = {
    query: { type: 'string', description: '搜索问题，如"NS125LA 气门间隙"' },
  } as const;
  readonly required = ['query'];

  constructor(
    private ai: Env['AI'],
    private index: Env['KNOWLEDGE_INDEX'],
  ) {}

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const query = (input.query as string)?.trim();
    if (!query) return t('knowledge.empty_query', lang);

    let vector: number[];
    try {
      vector = await embed(query, this.ai);
    } catch (e) {
      console.error('[knowledge] embed error:', e);
      return t('knowledge.embed_failed', lang);
    }

    let resp: { matches?: Array<{ metadata?: Record<string, unknown> }> };
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        resp = await Promise.race([
          this.index.query(vector, {
            topK: 5,
            returnMetadata: true,
            returnValues: false,
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Vectorize query timed out')), VECTORIZE_QUERY_TIMEOUT_MS);
          }),
        ]) as typeof resp;
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (e) {
      console.error('[knowledge] vectorize error:', e);
      return t('knowledge.search_failed', lang);
    }

    if (!resp.matches?.length) {
      return t('knowledge.no_results', lang);
    }

    const chunkIds = resp.matches
      .map(m => (m.metadata?.chunk_id as number | undefined))
      .filter((id): id is number => id !== undefined && id !== null);
    const chunks = await getChunksById(db, chunkIds);

    if (!chunks.length) {
      return t('knowledge.no_results', lang);
    }

    return chunks.map(c =>
      `📖 [${c.source_doc}${c.section_title ? ` · ${c.section_title}` : ''}]\n${c.chunk_text}`
    ).join('\n\n---\n\n');
  }
}
