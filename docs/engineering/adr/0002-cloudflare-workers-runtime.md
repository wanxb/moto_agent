# ADR-0002：运行时选 Cloudflare Workers

**状态**：✅ Accepted ·  **日期**：MVP 期

## 背景

需要一个承载 Telegram webhook 的运行时。要求：低成本（个人项目）、零/低运维、全球低延迟、与存储集成好。

## 决策

**部署在 Cloudflare Workers**，webhook 模式（非长轮询）。

## 理由 / 后果

**正面**：
- 免费层慷慨（10万次/天），MVP 几乎零成本（< $1/月），对比 Railway $6–8/月。
- 边缘执行、全球低延迟、无服务器管理。
- 与 D1 / KV / Cron Triggers / Pages 同生态无缝集成（支撑整条演进路线）。
- webhook 模式适配 Workers 无状态短请求模型，无需长连接。

**负面 / 代价（成为硬约束）**：
- 单请求 wall-time 有限 → Agent Loop 必须有轮数护栏（`MAX_ROUNDS`），不能跑长任务。
- 运行时非完整 Node（`nodejs_compat` 有限）→ 依赖选型受限。
- 无进程内持久状态 → 状态必须外置到 KV/D1。

> 这些约束写入 [`../../../CLAUDE.md`](../../../CLAUDE.md) §7 与 [架构文档](../architecture.md) §8。

## 备选方案

- **Railway / VPS（长驻进程）**：状态管理简单，但成本更高、需运维、无边缘优势。否决。
- **其它 Serverless（Vercel/Lambda）**：可行，但存储集成不如 Workers+D1+KV 一体化。否决。

## 关联

[ADR-0005](0005-d1-kv-storage.md) · [`../../PRD.md`](../../PRD.md) §5、§7。
