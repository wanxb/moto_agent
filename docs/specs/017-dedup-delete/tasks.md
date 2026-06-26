# 任务：重复录入软拦截 + 删除扩展

> 规格 017 · [requirements.md](requirements.md) · [design.md](design.md)

- [x] T1 迁移 0008：`maintenance_records` 加 `deleted_at` + 索引；同步 `docs/schema.sql`、`test/utils.ts`、`src/types.ts`、`data-model.md`
- [x] T2 DB 层：`getMaintenanceRecords` 过滤 `deleted_at`；新增 `softDeleteMaintenanceRecord` / `findMaintenanceRecords` / `findFuelRecords`
- [x] T3 Config：`FUEL_DUP_KM_THRESHOLD`、`MAINT_DUP_DAYS`
- [x] T4 去重软拦截：`log_fuel` / `log_maintenance` 加 `confirm` + 写前探测
- [x] T5 删除工具：`delete_last_fuel` 加 `confirm`；新增 `delete_maintenance`（keep_one）、`delete_fuel`；注册进 `index.ts`
- [x] T6 Prompt（zh+en）删除/去重规则；i18n `dup.*` / `delete.*` 成对键
- [x] T7 测试：`maintenance.test.ts` + `tools.test.ts` 覆盖去重/删除/软删过滤/keep_one
- [x] T8 门禁 `npm run type-check && npm test` 全绿（240 通过）
- [x] T9 迁移上线（local + remote）+ 清理线上重复补胎（保留 id 17，软删 id 18，剩 17 条活跃）
- [x] T10 文档：本 spec、`data-model.md`、CLAUDE.md §4 表格
