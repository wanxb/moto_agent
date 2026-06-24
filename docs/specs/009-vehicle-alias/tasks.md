# 任务：车辆别名

> 规格 009 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。**状态：全部完成。** 测试：147 passed（新增 12 条 alias）。

## A. 数据模型
- [x] **T1**：`migrations/0006_vehicle_alias.sql`（vehicles.alias + 唯一索引）；schema/utils/types 同步。

## B. 数据访问 + 工具
- [x] **T2**：`getVehicleByNameOrAlias` + `setVehicleAlias`（database.ts）。
- [x] **T3**：`resolveVehicle` 用双名匹配；`list_vehicles` 显示别名；`set_default_vehicle`/`rename_vehicle` 用双名查找；新增 `set_vehicle_alias` 工具。
- [x] **T4**：system prompt 规则 9 增别名。

## C. 测试 + 文档 + 部署
- [x] **T5**：`test/alias.test.ts` 12 条；147 passed；type-check exit 0。
- [x] **T6 文档**：data-model / agent-design / 索引 / 状态同步。
- [ ] **T7 部署**：提交 + push + 迁移 0006 + deploy — 进行中。

## 验收（DoD）
- [x] AC1–AC7 满足（12 条 test/alias.test.ts 覆盖）。
- [x] `npm run type-check && npm test` 全绿（147 passed）。
- [x] 既有功能零回归；别名对 LLM 透明（resolveVehicle 归一）。
- [x] 文档同步；参数化 + 唯一索引防重；无 secret。
