# 任务：摩托车知识库 RAG

> 规格 015 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。每条任务可独立验证。

---

## 任务清单

### Phase 1：基础设施 — 绑定 + 类型 + 数据表

- [ ] **T1 wrangler.toml + 类型**
  - 创建 Vectorize index：`wrangler vectorize create knowledge_index --dimensions=1024 --metric=cosine`
  - `wrangler.toml` 增加 `[[vectorize]]` 绑定（binding = "KNOWLEDGE_INDEX", index_name = "knowledge_index"）
  - `src/types.ts`：`Env` 增加 `KNOWLEDGE_INDEX: VectorizeIndex`；新增 `KnowledgeChunk` 接口
  - 验证：`npm run type-check` 通过

- [ ] **T2 D1 建表 + schema + test 同步**
  - `docs/schema.sql` 增加 `knowledge_chunks` 表定义（含索引）
  - `test/utils.ts` `initDB` 同步建表
  - 验证：`npm test` 中 knowledge 相关测试可建表

### Phase 2：运行时 RAG — 搜索 + 工具 + prompt

- [ ] **T3 embedding 函数**
  - 新建 `src/knowledge/embed.ts`：`embed(text: string, ai: Env['AI']): Promise<number[]>`
  - 调用 `@cf/baai/bge-m3`，返回 1024 维向量
  - 验证：`npm run type-check` 通过

- [ ] **T4 D1 数据访问函数**
  - 在 `src/database.ts` 新增 `getChunksById(db, ids)` 函数
  - 查询 `knowledge_chunks` WHERE id IN (...)，保持 Vectorize 返回顺序
  - 验证：`npm run type-check` 通过

- [ ] **T5 search_knowledge 工具**
  - 新建 `src/tools/knowledge-tools.ts`：`SearchKnowledgeTool` 实现 Tool 接口
  - execute 逻辑：embed → Vectorize query → getChunksById → 格式化 chunks 返回
  - `src/tools/index.ts` 注册 `SearchKnowledgeTool`
  - 验证：`npm run type-check` 通过

- [ ] **T6 prompt 规则**
  - `src/prompts.ts`：buildSystemPrompt 中英文各加一条第 17 条规则
  - 验证：人工检查 prompt 输出是否包含 `search_knowledge`

### Phase 3：离线入库脚本

- [ ] **T7 PDF 入库脚本**
  - 新建 `scripts/ingest-knowledge.ts`
  - 流程：扫描 `/knowledge/` 目录 PDF → PDF 解析（按章节分割）→ embed → 同时写入 D1 + Vectorize
  - 验证：对一本测试 PDF 运行脚本，确认 D1 有数据 + Vectorize 有索引

### Phase 4：测试 + 门禁

- [ ] **T8 测试**
  - 新建 `test/knowledge.test.ts`：
    - `SearchKnowledgeTool.execute` 正常路径（mock embedding + Vectorize + D1）
    - 空结果处理
    - Workers AI 错误处理
  - 验证：`npm test` 全绿

- [ ] **T9 全量门禁 + 文档**
  - `npm run type-check && npm test` 全绿
  - 确认无搜索 knowledge_chunks 的残留 import
  - `docs/specs/README.md` 索引标记 "✔️ Done"
  - 如需要更新 `CLAUDE.md` §4 代码地图

---

## 验收（Definition of Done）

- [ ] 所有 `requirements.md` 验收标准（AC1–AC5）满足。
- [ ] `npm run type-check && npm test` 全绿。
- [ ] 现有所有工具行为不变（**0 个现有工具文件被修改**）。
- [ ] `src/agent.ts`、`src/bootstrap.ts`、`src/config.ts`、`src/gateway/` **全部无变更**。
- [ ] 可运行入库脚本导入一本测试 PDF 并搜索到结果。
