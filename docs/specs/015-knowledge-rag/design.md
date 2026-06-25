# 设计：摩托车知识库 RAG

> 规格 015 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[architecture](../../engineering/architecture.md) · [agent-design](../../engineering/agent-design.md)

## 1. 方案概述

**零改动现有代码，纯新增**。加一个 `search_knowledge` 工具到主 registry，配 RAG 基础设施。Agent Loop 的多轮 `while` 本身提供多步搜索能力。

```
Agent Loop (runAgentLoop, 不变)
  └─ tools: [log_fuel, query_stats, ..., search_knowledge(新增)]
       ↑ LLM 自主判断何时调 search_knowledge

search_knowledge execute(query)
  1. embed(query)               → Workers AI bge-m3
  2. Vectorize.query(vector)     → top-5 chunks
  3. getChunksById(ids)          → D1 拉原文
  4. return chunks to LLM        → LLM 合成回答
```

## 2. 数据模型变更

### D1 新增表

```sql
-- 知识库 chunk 表
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_text   TEXT    NOT NULL,              -- chunk 原文
    source_doc   TEXT    NOT NULL,              -- 来源文件名（如 "NS125LA_manual.pdf"）
    section_title TEXT,                         -- 章节标题（如 "机油更换"）
    chunk_index  INTEGER NOT NULL,              -- 文档内序号
    topics       TEXT,                          -- 逗号分隔的话题标签（如 "oil,maintenance"）
    doc_hash     TEXT,                          -- 文档级 hash（用于未来去重）
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_chunks(source_doc);
```

- `docs/schema.sql`：同步更新
- `test/utils.ts`：`initDB` 中加同步建表

### Vectorize index

```bash
wrangler vectorize create knowledge_index --dimensions=1024 --metric=cosine
```

### Vectorize metadata 结构

```json
{
  "chunk_id": 1,
  "source_doc": "NS125LA_manual.pdf",
  "section": "轮胎规格",
  "topics": "tire,pressure"
}
```

## 3. 工具契约变更

### 新增 `search_knowledge`

| 属性 | 值 |
|------|-----|
| 名称 | `search_knowledge` |
| 描述 | "搜索摩托车维修和保养知识库。用户问专业保养/维修/故障问题时调用。" |
| 参数 | `query: string`（搜索问题） |
| 必填 | `query` |
| 返回 | 格式化的 chunks 文本，每段含来源标注 `📖 [文件名 · 章节标题]` |

```typescript
class SearchKnowledgeTool implements Tool {
  readonly name = 'search_knowledge';
  readonly description = '搜索摩托车维修和保养知识库。用户问专业保养/维修/故障问题时调用。';
  readonly descriptionEn = 'Search the motorcycle maintenance knowledge base. Call when user asks repair/maintenance/troubleshooting questions.';
  readonly parameters = {
    query: { type: 'string', description: '搜索问题，如"NS125LA 气门间隙"' },
  };
  readonly required = ['query'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const query = input.query as string;
    const vector = await embed(query, this.ai);        // Workers AI @cf/baai/bge-m3
    const matches = await this.index.query(vector, {   // Vectorize
      topK: 5, returnMetadata: true, returnValues: false,
    });
    const chunkIds = matches.matches.map(m => m.metadata.chunk_id as number);
    const chunks = await getChunksById(db, chunkIds);  // D1
    return formatChunks(chunks, lang);
  }
}
```

### 其他工具

全部不变。无签名、无参数、无行为改变。

## 4. Prompt 影响

`src/prompts.ts` 的 `buildSystemPrompt` 中新增一条规则。

**中文版**（第 16 条后追加）：

```
17. 用户问保养/维修/故障诊断/使用操作等专业知识（如"怎么换机油""故障灯亮了""胎压多少""发动机异响"）时调用 search_knowledge。搜索结果来源于手册等权威资料，不要用自己的知识代替。
```

**英文版**（第 16 条后追加）：

```
17. For maintenance/repair/troubleshooting questions ("how to change oil", "check engine light", "tire pressure"), call search_knowledge. Results come from official manuals — don't substitute with your own knowledge.
```

## 5. 数据访问层（database.ts）

新增两个函数：

```typescript
// 按 id 列表查询 chunk 原文
export async function getChunksById(db: D1Database, ids: number[]): Promise<KnowledgeChunk[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db.prepare(
    `SELECT * FROM knowledge_chunks WHERE id IN (${placeholders})`
  ).bind(...ids).all<KnowledgeChunk>();
  // 保持 ids 顺序（Vectorize 返回的顺序就是相关度排序）
  const map = new Map(results.map(r => [r.id, r]));
  return ids.map(id => map.get(id)).filter((r): r is KnowledgeChunk => r !== undefined);
}
```

同时新增 `KnowledgeChunk` 类型到 `src/types.ts`。

## 6. 新增/修改文件清单

### 新增文件

| 文件 | 职责 | 行数 |
|------|------|------|
| `src/tools/knowledge-tools.ts` | `SearchKnowledgeTool` 类 | ~60 |
| `src/knowledge/embed.ts` | `embed(text, ai)` 函数 | ~15 |
| `src/knowledge/search.ts` | `searchIndex(text, ai, index, db)` 编排函数 | ~25 |
| `src/knowledge/types.ts` | `KnowledgeChunk` 类型（或放 types.ts） | ~10 |
| `scripts/ingest-knowledge.ts` | 离线 PDF 入库脚本 | ~120 |
| `test/knowledge.test.ts` | search_knowledge 工具 + RAG 流程测试 | ~60 |

### 修改文件

| 文件 | 改动 | 行数 |
|------|------|------|
| `src/types.ts` | `Env` 加 `KNOWLEDGE_INDEX: VectorizeIndex`；加 `KnowledgeChunk` 类型 | ~5 |
| `src/tools/index.ts` | 注册 `SearchKnowledgeTool` | ~3 |
| `src/prompts.ts` | 加第 17 条规则（中英各一行） | ~4 |
| `docs/schema.sql` | 加 `knowledge_chunks` 表 | ~15 |
| `test/utils.ts` | `initDB` 加 knowledge_chunks 建表 | ~10 |
| `wrangler.toml` | 加 `[[vectorize]]` 绑定 | ~5 |

### 无变更文件

`src/agent.ts`、`src/bootstrap.ts`、`src/config.ts`、`src/gateway/pipeline.ts`、`src/router/`、`test/utils.ts` 的 `makeEnv`/`clearDB`、所有现有工具文件。

## 7. 流程 / 时序

### 运行时：一次知识查询

```
用户: "NS125LA 胎压多少"
  ↓
agent.ts runAgentLoop (不变)
  └─ Round 1: LLM 选择 search_knowledge(query="NS125LA 胎压")
       ↓
     SearchKnowledgeTool.execute()
       ├─ embed("NS125LA 胎压", AI)              → 1024维向量, ~50ms
       ├─ KNOWLEDGE_INDEX.query(vector, topK=5)  → 5个metadata, ~10ms
       ├─ getChunksById(db, [3, 7, 12, ...])     → 5段原文, ~5ms
       └─ 返回格式化文本 → LLM
       ↓
  └─ Round 2: LLM 合成回答 → 用户
```

### 离线：入库脚本

```
scripts/ingest-knowledge.ts
  └─ PDF 文件列表
       ↓
     PDF → 按章节分割 → chunks
       ↓
     embed(chunk) → Vectorize insert
     insert D1 (chunk_text, source_doc, section_title, ...)
```

## 8. 边界与错误处理

- **embedding 失败**：Workers AI 出错 → 工具返回可读错误，LLM 回复"知识库暂时不可用"
- **Vectorize 无匹配**：返回空结果 → LLM 回复"知识库中未找到相关信息，建议去维修站咨询"
- **搜索结果不精确**：LLM 可能在第 2 轮重新搜索（换关键词），不阻塞
- **D1 无 match**：Vectorize 返回的 chunk_id 在 D1 中不存在 → 静默跳过，不抛异常
- **PDF 解析失败**：离线脚本跳过该文件，打印错误

## 9. 风险与权衡

| 风险 | 缓解 |
|------|------|
| bge-m3 中文 + 摩托车术语的效果未知 | 初始通过离线脚本批量测试几个典型查询；效果差可换 `@cf/intfloat/multilingual-e5` |
| Vectorize query 的 metadata filter 在 v1 不用但后续需要 | v1 不做车型过滤，所有 chunk 混搜。后续按需加 `vehicle_id` metadata |
| Workers AI 75 次/分钟免费限频 | 每次请求只做一次 embedding，不限频 |
| Chunk 数增加后 Vectorize 费用增长 | 5k 向量免费，20k 向量约 $1/月，100 本手册内可控 |

## 10. 测试要点

- `SearchKnowledgeTool.execute` 单元测试（mock Workers AI + Vectorize + D1）
- `embed()` 单元测试（mock Workers AI 返回）
- `getChunksById` 单元测试（真实 D1，mock 数据）
- 知识库 prompt 规则测试（确保 LLM 被引导调 search_knowledge）
- 回归：所有现有 215 个测试全部通过
