# ADR-0005：D1（业务）+ KV（会话）双存储

**状态**：✅ Accepted ·  **日期**：MVP 期

## 背景

Workers 无进程内持久状态，需外置两类状态：**业务数据**（加油/里程，关系型、需查询统计）与**会话历史**（短期、KV 式读写、需 TTL）。

## 决策

- **业务数据 → Cloudflare D1**（SQLite 兼容关系库）。
- **会话历史 → Cloudflare KV**（`session:{chatId}`，最近 10 条，TTL 1h）。

## 理由 / 后果

**正面**：
- D1：SQL 适合油耗的区间计算/范围查询；Workers 原生集成、零配置、免费层 5GB；SQLite 兼容，本地测试用 Miniflare 真实 D1。
- KV：低延迟读写、原生 TTL，恰好匹配"短期会话历史"语义；与 D1 职责分离，互不污染。
- 两者都在 Cloudflare 生态内，无外部依赖（演进原则）。

**负面 / 代价**：
- KV 最终一致 → 极端并发下会话历史可能短暂不一致（单用户可忽略）。
- D1 单库容量/写并发有上限（MVP/Phase 2 远未触及；Phase 3 视量评估 Hyperdrive+PG）。
- 两套存储 API，但职责清晰、心智负担低。

## 关键约定

- **业务数据查询排序基准用 `odometer`**（单调递增），而非 `date`，更可靠（见 [`../data-model.md`](../data-model.md) §3）。
- **schema 只增不删**，保护历史数据（[ADR 不变量](../data-model.md) §5）。

## 备选方案

- **全放 D1（含会话）**：会话的 TTL/高频读写不如 KV 自然，且污染业务库。否决。
- **外部 PostgreSQL**：超出 MVP 需求、增成本与运维。Phase 3 数据量超限再议。否决。
- **Durable Objects 存会话**：更强一致但更复杂，单用户不需要。否决（YAGNI）。

## 关联

[`../data-model.md`](../data-model.md) · [ADR-0002](0002-cloudflare-workers-runtime.md) · [`../../PRD.md`](../../PRD.md) §5、§6。
