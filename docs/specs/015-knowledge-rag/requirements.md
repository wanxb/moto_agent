# 需求：摩托车知识库 RAG

> 规格 015 · 状态：📝 草稿 · 阶段：Phase 3 · 优先级：P1
> 关联：[roadmap](../../product/roadmap.md) · [design.md](design.md) · [tasks.md](tasks.md)

## 1. 问题陈述

用户经常问摩托车保养、维修、故障排查类的专业知识（如"多少公里换机油""发动机异响怎么回事""胎压多少合适"）。目前 Agent 靠自身 LLM 知识回答，存在两个问题：

1. **幻觉**——LLM 可能编造不存在的规格参数
2. **不精确**——通用知识不具备车型特异性（NS125LA 和 CB400 的机油规格不同）

需要一个**专业知识库**，将用户手册/维修手册以 RAG 方式融入系统，让 Agent 能检索到权威资料后回答。

## 2. 用户故事

- 作为**摩托车用户**，当我问**"NS125LA 胎压多少"**，我希望得到**手册中的准确值**而非 LLM 的猜测。
- 作为**摩托车用户**，当我描述**"发动机有哒哒声"**，我希望**系统能从维修手册中找到对应的故障原因和建议**。
- 作为**开发者**，我希望**知识库作为一个工具注册到现有 Agent**，不改动已有工具和 Agent Loop。

## 3. 范围

**In Scope**

- 运行时 RAG 检索（Worker 内）：embedding → Vectorize 搜索 → D1 取 chunk 原文
- `search_knowledge` 工具注册到主 registry
- `Env` 增加 `KNOWLEDGE_INDEX` 绑定
- `wrangler.toml` 增加 `[[vectorize]]` 绑定
- D1 `knowledge_chunks` 表 + `test/utils.ts` 同步
- System prompt 加一行"知识问题用 search_knowledge"
- 离线入库脚本 `scripts/ingest-knowledge.ts`（PDF → chunk → embed → 入库）
- `test/utils.ts` 同步 `knowledge_chunks` 建表

**Out of Scope**

- 子 Agent / 多 Agent 机制（不需要——主 Loop 的多轮循环已够用）
- PDF 的 web 上传 / 管理界面
- MinHash-LSH 去重（v1 先全量入库，v2 再优化去重）
- 版本追踪（v1 只存最新版本）
- 车型 metadata 过滤（v1 不做，所有手册内容都可检索）

## 4. 验收标准

- **AC1** Given `search_knowledge` 工具，When 收到 "NS125LA 胎压"，Then 返回包含胎压数值的 chunk 内容。
- **AC2** Given 用户问"发动机异响"，When Agent 调 search_knowledge，Then 返回相关的故障排查 chunk。
- **AC3** Given 现有测试套件，When 本 spec 变更完成，Then `npm run type-check && npm test` 全绿。
- **AC4** Given 现有工具全部不动，When 新增 search_knowledge，Then 所有现有工具行为不变。
- **AC5** Given `scripts/ingest-knowledge.ts`，When 输入一个 PDF，Then 生成 chunks 并写入 D1 + Vectorize。

## 5. 交互示例

```
用户：NS125LA 胎压打多少
Bot（通过 search_knowledge → LLM 合成）：
📖 根据《NS125LA 用户手册》：
- 前轮：1.75 bar（25 psi）
- 后轮：2.00 bar（29 psi）
单人骑行推荐前 1.75 / 后 2.00，双人推荐前 1.75 / 后 2.25。
```

```
用户：发动机有哒哒声
Bot（search_knowledge 可能搜到气门间隙、链条松动等）：
📖 根据《NS125LA 维修手册》：
发动机异响可能原因：
1. 气门间隙过大（需调整至 0.05mm）
2. 正时链条松动（需张紧）
3. 建议去维修站专业检查，以免加剧磨损
```

## 6. 依赖与假设

- 依赖：Cloudflare Vectorize（GA 状态），Workers AI `@cf/baai/bge-m3`（已在 STT 中用 Workers AI）
- 假设：embedding 模型 `@cf/baai/bge-m3` 在 Workers AI 中可用且延迟 <100ms
- 假设：Vectorize 已预先创建好 index（`wrangler vectorize create knowledge_index --dimensions=1024 --metric=cosine`）

## 7. 开放问题

| 问题 | 影响 | 待决 |
|------|------|------|
| 初始 PDF 如何提供？Git 仓库直接放 /knowledge/ 目录？还是 R2？ | 中等 | 初始用 Git 仓库 `/knowledge/` 目录，后续可迁移到 R2 |
| Vectorize 有免费额度吗？ | 低 | 5k vectors 免费，本项目月付约 $1 |
| bge-m3 的中文 embedding 效果如何？ | 中 | 基准测试中 bge-m3 是 multilingual SOTA，摩托车术语需验证 |
