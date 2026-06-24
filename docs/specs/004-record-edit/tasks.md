# 任务：记录纠错 / 删除

> 规格 004 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。复用 spec 001 `resolveVehicle`。
>
> **状态：T1–T7 已完成；T8（线上部署）与 001–003 一并待上线。** 测试：111 passed（新增 11 条 `test/record-edit.test.ts`）。

## 阶段 A — 数据模型

- [x] **T1 迁移 + schema + utils + types**：`migrations/0004_soft_delete.sql`（`fuel_records` 加 `deleted_at` + 索引）；`docs/schema.sql`、`test/utils.ts`、`types.ts` 同步。
  - ✅ 本地用 pre-004 表执行成功（存量行 `deleted_at`=NULL）；既有 100 测试零回归。

## 阶段 B — 数据访问层（database.ts）

- [x] **T2 读路径过滤**：`getLastFuelRecord` / `getRecentFuelRecords` / `getFuelRecordsByDateRange` / `getLatestOdometer`（fuel 子查询）加 `deleted_at IS NULL`。
  - ✅ 软删后各函数均排除该记录（专项测试）。
- [x] **T3 写函数**：`updateFuelRecord`（列白名单 + 参数化动态 SET）/ `softDeleteFuelRecord`。
  - ✅ 改单/多字段；白名单外（id/vehicle_id/evil）被忽略；空字段 no-op。

## 阶段 C — 工具 + Prompt

- [x] **T4 工具**：`update_last_fuel` / `delete_last_fuel`，复用 `resolveVehicle`，回显结果。
  - ✅ 覆盖 AC1–AC8。
- [x] **T5 Prompt**：`buildSystemPrompt` 增纠错规则 13–14。

## 阶段 D — 测试 + 文档

- [x] **T6 测试**：`test/record-edit.test.ts` 11 条；`npm run type-check && npm test` 全绿（111 passed）。
- [x] **T7 文档**：`data-model.md`（`deleted_at` + 迁移 0004 + 已知问题更新）、`agent-design.md` §2、本 spec/索引/`docs/README`/`roadmap`/`backlog` 状态同步。
- [ ] **T8 部署**：线上 `migrations/0004_soft_delete.sql`（⏳ 与 001–003 一并待上线）。

## 验收（DoD）

- [x] AC1–AC8 满足（经 `test/record-edit.test.ts` 验证）。
- [x] `npm run type-check && npm test` 全绿（111 passed）。
- [x] 软删记录不出现在任何读路径（last/recent/range/latestOdometer/统计/提醒，均有断言）。
- [x] 列白名单 + 参数化，无注入；受影响文档同步更新。
