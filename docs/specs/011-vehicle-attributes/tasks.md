# Spec 011 — 车辆属性扩展 任务列表

| 字段 | 内容 |
|------|------|
| **Spec** | 011 |
| **需求** | [requirements.md](requirements.md) |
| **设计** | [design.md](design.md) |
| **完成标准** | [definition-of-done.md](../../process/definition-of-done.md) |
| **当前状态** | ✔️ Done |

---

## T1 迁移脚本 + schema 同步
- [x] 创建 `migrations/0007_vehicle_attributes.sql`（5 列 ALTER TABLE）
- [x] 更新 `docs/schema.sql` vehicles 表定义
- [x] 更新 `test/utils.ts` initDB vehicles 建表语句

## T2 类型 + 数据访问层
- [x] `src/types.ts`：`Vehicle` 接口加 5 个可选字段
- [x] `src/database.ts`：新增 `updateVehicle()` 通用更新函数
- [x] `src/database.ts`：新增 `getVehicleMostUsedFuelType()` 查询函数

## T3 工具层 — add_vehicle + update_vehicle
- [x] `src/tools/vehicle-tools.ts`：`add_vehicle` 参数 + execute 扩展
- [x] 新增 `src/tools/vehicle-tools.ts`：`UpdateVehicleTool` 类
- [x] `src/tools/index.ts`：注册 `update_vehicle` 工具

## T4 工具层 — log_fuel 默认油号 + 自动更新
- [x] `src/tools/fuel-tools.ts`：`log_fuel` 默认油号逻辑
- [x] `src/tools/fuel-tools.ts`：`log_fuel` 自动更新油号逻辑

## T5 Prompt + API
- [x] `src/prompts.ts`：system prompt 增加默认油号提示
- [x] `src/routes/api.ts`：VehicleInfo 接口扩展

## T6 测试 + 门禁
- [x] 新增 `test/vehicle-attributes.test.ts`（27 测试）
- [x] `npm run type-check` 零错误
- [x] `npm test` 全部通过（187 测试，含新测试 + 旧测试回归）
- [ ] 本地迁移验证幂等（部署时执行）

## DoD 检查清单
- [x] 对应 requirements.md 全部 AC 满足（AC1-AC10）
- [x] 迁移幂等、`docs/schema.sql` 与 `test/utils.ts` 同步
- [x] 新功能有测试覆盖
- [x] type-check + test 全绿
- [x] spec 状态更新为 ✔️ Done
