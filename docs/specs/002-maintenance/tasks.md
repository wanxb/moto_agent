# 任务：维修保养记录

> 规格 002 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。复用 spec 001 的 `resolveVehicle`，不重复实现车辆解析。
>
> **状态：T1–T6 已完成；T7（线上部署）与 001 一并待上线。** 测试：82 passed（新增 12 条 `test/maintenance.test.ts`）。

## 阶段 A — 数据模型

- [x] **T1 迁移 + schema + utils**：`migrations/0002_maintenance.sql`（`IF NOT EXISTS` 可重入）；`schema.sql` 加表；`test/utils.ts` 同步；`types.ts` 加 `MaintenanceRecord`。
  - ✅ 本地执行成功 + 二次执行验证可重入；既有 70 测试零回归。

## 阶段 B — 数据访问层（database.ts）

- [x] **T2 maintenance 函数**：`insertMaintenanceRecord` / `getMaintenanceRecords({vehicleId?,type?,limit?})` / `getLastMaintenanceByType(type, vehicleId?)`。
  - ✅ `test/maintenance.test.ts` 覆盖按车 + 按类型过滤 + 排序。

## 阶段 C — 工具层 + Prompt

- [x] **T3 工具**：`log_maintenance` / `query_maintenance`，复用 `resolveVehicle`，缺省里程/费用显示 `—`。
  - ✅ 覆盖 AC1–AC6。
- [x] **T4 Prompt**：`agent.ts buildSystemPrompt` 增维保规则 9–10。

## 阶段 D — 测试 + 文档

- [x] **T5 测试**：`test/maintenance.test.ts` 12 条；`npm run type-check && npm test` 全绿（82 passed）。
- [x] **T6 文档**：`data-model.md`、`agent-design.md` §2、本 spec/索引/`docs/README.md`/`roadmap.md` 状态同步。
- [ ] **T7 部署**：线上执行 `migrations/0002_maintenance.sql`（⏳ 与 001 一并待上线）。

## 验收（DoD）

- [x] AC1–AC6 满足（经 `test/maintenance.test.ts` 验证）。
- [x] `npm run type-check && npm test` 全绿（82 passed）。
- [x] 不影响加油/油耗既有功能（既有测试零回归）。
- [x] 受影响文档同步更新。
- [x] 参数化绑定、无 secret。
