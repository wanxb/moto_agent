import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { SearchKnowledgeTool } from '../src/tools/knowledge-tools';
import { getChunksById } from '../src/database';
import { initDB, clearDB } from './utils';

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_CHUNKS = [
  { id: 1, chunk_text: '前轮推荐气压：1.75 bar（25 psi）', source_doc: 'NS125LA_manual.pdf', section_title: '轮胎规格', chunk_index: 0, topics: 'tire,pressure', doc_hash: null, created_at: '' },
  { id: 2, chunk_text: '后轮推荐气压：2.00 bar（29 psi）', source_doc: 'NS125LA_manual.pdf', section_title: '轮胎规格', chunk_index: 1, topics: 'tire,pressure', doc_hash: null, created_at: '' },
  { id: 3, chunk_text: '发动机异响可能原因：1. 气门间隙过大 2. 正时链条松动', source_doc: 'NS125LA_manual.pdf', section_title: '故障排查', chunk_index: 0, topics: 'engine,noise', doc_hash: null, created_at: '' },
];

/** 创建 mock Workers AI */
function mockAI(data?: number[][]): { run: ReturnType<typeof vi.fn> } {
  const run = vi.fn().mockResolvedValue({ data: data ?? [[0.1, 0.2, 0.3]] });
  return { run };
}

/** 创建 mock VectorizeIndex */
function mockIndex(matches?: Array<{ metadata?: Record<string, unknown> }>): { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue({ matches: matches ?? [] });
  return { query };
}

/** 插入 mock chunk 到 D1 */
async function insertMockChunks(): Promise<void> {
  for (const c of MOCK_CHUNKS) {
    await env.DB.prepare(
      'INSERT INTO knowledge_chunks (id, chunk_text, source_doc, section_title, chunk_index) VALUES (?, ?, ?, ?, ?)'
    ).bind(c.id, c.chunk_text, c.source_doc, c.section_title, c.chunk_index).run();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SearchKnowledgeTool', () => {
  it('成功搜索并返回格式化 chunks', async () => {
    await insertMockChunks();
    const ai = mockAI();
    const index = mockIndex([
      { metadata: { chunk_id: 1 } },
      { metadata: { chunk_id: 2 } },
    ]);
    const tool = new SearchKnowledgeTool(ai, index as never);

    const result = await tool.execute({ query: 'NS125LA 胎压' }, env.DB, 'zh');

    expect(result).toContain('📖 [NS125LA_manual.pdf · 轮胎规格]');
    expect(result).toContain('前轮推荐气压：1.75 bar');
    expect(result).toContain('后轮推荐气压：2.00 bar');
    expect(result).toContain('---');
    expect(ai.run).toHaveBeenCalledOnce();
    expect(index.query).toHaveBeenCalledOnce();
  });

  it('空查询时返回错误提示', async () => {
    const tool = new SearchKnowledgeTool(mockAI(), mockIndex() as never);
    const result = await tool.execute({ query: '' }, env.DB, 'zh');
    expect(result).toBe('请输入要搜索的问题。');
  });

  it('query 全空格时返回错误提示', async () => {
    const tool = new SearchKnowledgeTool(mockAI(), mockIndex() as never);
    const result = await tool.execute({ query: '   ' }, env.DB, 'zh');
    expect(result).toBe('请输入要搜索的问题。');
  });

  it('Vectorize 返回空时提示未找到', async () => {
    const ai = mockAI();
    const index = mockIndex([]);
    const tool = new SearchKnowledgeTool(ai, index as never);

    const result = await tool.execute({ query: '不存在的内容' }, env.DB, 'zh');
    expect(result).toBe('📖 知识库中未找到相关信息。建议去专业维修站咨询。');
    expect(ai.run).toHaveBeenCalledOnce();
    expect(index.query).toHaveBeenCalledOnce();
  });

  it('Vectorize 匹配但 D1 无对应记录时返回未找到', async () => {
    const ai = mockAI();
    const index = mockIndex([{ metadata: { chunk_id: 999 } }]);
    const tool = new SearchKnowledgeTool(ai, index as never);

    const result = await tool.execute({ query: '丢失的 chunk' }, env.DB, 'zh');
    expect(result).toBe('📖 知识库中未找到相关信息。建议去专业维修站咨询。');
  });

  it('embedding 失败时返回错误提示', async () => {
    const ai = { run: vi.fn().mockRejectedValue(new Error('AI error')) };
    const index = mockIndex();
    const tool = new SearchKnowledgeTool(ai, index as never);

    const result = await tool.execute({ query: '测试' }, env.DB, 'zh');
    expect(result).toBe('知识库检索失败（向量化错误），请稍后重试。');
  });

  it('Vectorize search 失败时返回错误提示', async () => {
    const ai = mockAI();
    const index = { query: vi.fn().mockRejectedValue(new Error('search error')) };
    const tool = new SearchKnowledgeTool(ai, index as never);

    const result = await tool.execute({ query: '测试' }, env.DB, 'zh');
    expect(result).toBe('知识库检索失败（搜索错误），请稍后重试。');
  });

  it('英文查询返回英文结果格式', async () => {
    await insertMockChunks();
    const ai = mockAI();
    const index = mockIndex([{ metadata: { chunk_id: 1 } }]);
    const tool = new SearchKnowledgeTool(ai, index as never);

    const result = await tool.execute({ query: 'tire pressure NS125LA' }, env.DB, 'en');
    expect(result).toContain('📖 [NS125LA_manual.pdf · 轮胎规格]');
    expect(result).toContain('前轮推荐气压');
  });
});

describe('getChunksById (database layer)', () => {
  it('空列表返回空数组', async () => {
    const result = await getChunksById(env.DB, []);
    expect(result).toEqual([]);
  });

  it('存在时按传入顺序返回', async () => {
    await insertMockChunks();
    const result = await getChunksById(env.DB, [3, 1]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(3);
    expect(result[1].id).toBe(1);
  });

  it('部分 chunk 不存在时跳过', async () => {
    await insertMockChunks();
    const result = await getChunksById(env.DB, [1, 999, 2]);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
  });
});
