# 任务：质量加固

> 规格 006 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。
>
> **状态：T1–T7 完成；T8 部署进行中。** 测试：124 passed。

## A. 指标埋点
- [x] **T1**：`session.ts` 用 `Date.now()` 包 `agentLoop`，输出 `[metric] latency_ms=.. status=.. chat=..`；catch 记 error。
  - ✅ `session.test.ts` 既有用例不破。

## B. 提醒自动续期
- [x] **T2 迁移 + schema + utils + types**：`migrations/0005_reminder_interval.sql`（`reminders` 加 `interval_km`）；同步三处 + `Reminder.interval_km`。
- [x] **T3 set_reminder 存间隔**：里程间隔模式存 `interval_km`（绝对目标不存→一次性）；回显"自动续期"。
- [x] **T4 runScheduled 续期**：触发后 mileage + interval_km 新建下一条（目标+间隔），推送追加"已续期下次 X km"。
  - ✅ `reminders.test.ts` AC-B1/B2 续期、AC-B3 绝对不续、AC-B4 日期不续。

## C. LLM 评测集
- [x] **T5**：`agent.ts` 导出 `buildSystemPrompt`；`test/eval/cases.json`（20 条覆盖各功能）；`scripts/eval.ts`；`package.json` `eval` 脚本。
  - ✅ 脚本自检通过（imports OK，无 key 优雅退出）；不进 `npm test`。

## D. 收尾
- [x] **T6 测试**：`npm run type-check && npm test` 全绿（124 passed）。
- [x] **T7 文档**：`observability-ops`/`testing-strategy`/`data-model`/`agent-design` + 本 spec/索引/状态同步。
- [ ] **T8 部署**：提交 + push + 迁移 0005（线上）+ `npm run deploy`；指引用户设 `ANTHROPIC_API_KEY` — 进行中。

## 验收（DoD）
- [x] AC-A1/A2、AC-B1–B4、AC-C1–C3 满足。
- [x] `npm run type-check && npm test` 全绿；`npm run eval` 不进 CI。
- [x] 迁移说明（ALTER 前向一次性）；参数化、无 secret；文档同步。
