# ADR-0006：定时提醒用 Cloudflare Cron Triggers

**状态**：✅ Accepted ·  **日期**：Phase 2（spec 003）

## 背景

[spec 003 定时提醒](../../specs/003-reminders/) 需要在"无用户请求"时主动检查到期提醒并推送。这是项目第一个非 webhook 入口——webhook 模式只在用户发消息时被动触发，无法满足"到期主动提醒"。

## 决策

**用 Cloudflare Cron Triggers**：在 `src/index.ts` 默认导出新增 `scheduled()` handler，`wrangler.toml` 配 `[triggers] crons = ["0 1 * * *"]`（每日 01:00 UTC），唤醒 Worker 执行 `runScheduled(env)` 扫描到期提醒并经 Telegram Bot API 推送。

## 理由 / 后果

**正面**：
- Workers 原生能力，零额外基础设施，留在 Cloudflare 生态（[ADR-0002](0002-cloudflare-workers-runtime.md) 演进原则）。
- 与现有 D1/KV 同 Worker，直接复用数据层与类型，无跨服务调用。
- 替代教程 S13/S14 的后台任务/Cron 调度器（[agent-design §6](../agent-design.md)），更轻。

**负面 / 代价**：
- `scheduled()` **无 per-request 用户上下文**：推送目标需另存。MVP 用 `env.ALLOWED_CHAT_ID`，表中预留 `chat_id` 列供多用户。
- Cron 最小粒度受限 + 每日一次 → 提醒有最长 ~24h 延迟（保养场景可接受）。
- 里程类提醒依赖用户记录里程才能判定"当前里程"（日期类不受影响）。
- 引入时钟依赖 → 通过 `runScheduled(env, { today, send })` 注入 `today` 与发送函数，保持纯逻辑可测（[testing-strategy](../testing-strategy.md)）。

## 去重与可靠性

- 仅推送**成功后**才 `markReminderDone`（status=active→done），失败保持 active 下次重试，避免丢提醒。
- 一次性提醒：触发即 done；循环提醒（如每 3000km 自动续期）留待下一迭代。

## 备选方案

- **外部 cron/定时服务（如 GitHub Actions 定时调 webhook）**：引入外部依赖、需暴露触发端点、鉴权复杂。否决。
- **Durable Objects Alarm**：更强但更重，单用户提醒不需要。否决（YAGNI）。
- **每次用户消息时顺带检查**：无法满足日期类"用户不来也要提醒"。否决（不满足 US5）。

## 关联

[spec 003](../../specs/003-reminders/) · [architecture §3](../architecture.md) · [observability-ops](../observability-ops.md) · [ADR-0002](0002-cloudflare-workers-runtime.md)。
