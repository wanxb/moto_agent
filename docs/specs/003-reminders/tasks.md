# 任务：定时提醒

> 规格 003 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。复用 spec 001 `resolveVehicle`、spec 002 `getLastMaintenanceByType`。
>
> **状态：T1–T8 已完成；T9（线上部署 + Cron 注册）待上线。** 测试：100 passed（新增 18 条 `test/reminders.test.ts`）。

## 阶段 A — 数据模型

- [x] **T1 迁移 + schema + utils + types**：`migrations/0003_reminders.sql`（可重入）；`schema.sql`、`test/utils.ts`、`types.ts`（`Reminder`/`ReminderWithVehicle`）同步。
  - ✅ 本地执行 + 二次执行验证可重入（6 张表就位）；既有 82 测试零回归。

## 阶段 B — 数据访问层（database.ts）

- [x] **T2 reminders 函数 + getLatestOdometer**：`insertReminder` / `getActiveReminders`（JOIN 车名）/ `listRemindersByVehicle` / `cancelReminders` / `markReminderDone` / `getLatestOdometer`。
  - ✅ 覆盖 CRUD + 跨 fuel/mileage 取 max + 按车。

## 阶段 C — 工具 + 调度 + 入口

- [x] **T3 工具**：`set_reminder` / `list_reminders` / `cancel_reminder`，里程三路径（绝对/间隔+保养基准/间隔+里程基准），复用 `resolveVehicle`。
  - ✅ 覆盖 AC1–AC5。
- [x] **T4 调度逻辑**：`src/scheduled.ts` `findDueReminders` + `runScheduled` + `formatReminder`。
  - ✅ AC6/AC7/AC8（去重）/AC9（按车隔离）；推送失败不标记 done。
- [x] **T5 入口 + Cron**：`index.ts` 加 `scheduled()`；`wrangler.toml` 加 `[triggers] crons = ["0 1 * * *"]`。
  - ✅ type-check 通过。本地可 `wrangler dev --test-scheduled` 手动验证（见 [observability-ops §6](../../engineering/observability-ops.md)）。
- [x] **T6 Prompt**：`buildSystemPrompt` 增提醒规则 11–12。

## 阶段 D — 测试 + 文档

- [x] **T7 测试**：`test/reminders.test.ts` 18 条；`npm run type-check && npm test` 全绿（100 passed）。
- [x] **T8 文档**：新增 [ADR-0006](../../engineering/adr/0006-cron-triggers-scheduled.md)；`architecture.md`、`observability-ops.md`、`data-model.md`、`agent-design.md` §2、本 spec/索引/`docs/README`/`roadmap`/`backlog` 状态同步。
- [ ] **T9 部署**：线上 `migrations/0003_reminders.sql` + `deploy`（注册 Cron）（⏳ 与 001/002 一并待上线）。

## 验收（DoD）

- [x] AC1–AC9 满足（经 `test/reminders.test.ts` 验证）。
- [x] `npm run type-check && npm test` 全绿（100 passed）。
- [x] 不影响既有功能（既有测试零回归）。
- [x] 受影响文档同步更新（含新 ADR-0006）。
- [x] 参数化绑定、无 secret；推送失败不标记 done（可重试）。
