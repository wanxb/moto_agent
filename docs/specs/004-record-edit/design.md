# 设计：记录纠错 / 删除

> 规格 004 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[data-model](../../engineering/data-model.md) · [agent-design](../../engineering/agent-design.md) · 复用 [spec 001](../001-multi-vehicle/design.md)

## 1. 方案概述

给 `fuel_records` 加 `deleted_at` 列实现**软删除**（守"只增不删"——既不删行也不删 schema，仅打标记）。**所有加油读路径**统一过滤 `deleted_at IS NULL`，确保软删后统计/最近记录/里程提醒判定都不再包含它。新增两个工具 `update_last_fuel` / `delete_last_fuel`，作用于（经 `resolveVehicle` 解析的）指定/默认车的最近一条加油记录。`update` 用列白名单 + 参数化绑定动态拼 SET，只改用户指明的字段。

## 2. 数据模型变更

```sql
ALTER TABLE fuel_records ADD COLUMN deleted_at TEXT;   -- NULL=活跃；非空=软删除时刻
CREATE INDEX IF NOT EXISTS idx_fuel_deleted ON fuel_records(deleted_at);
```

- 迁移 `migrations/0004_soft_delete.sql`（`ALTER ADD COLUMN` 非幂等，前向一次性；与 [0001](../../migrations/0001_multi_vehicle.sql) 同模式）。
- 同步 `schema.sql`（fuel_records 加列）+ `test/utils.ts`（建表加列）+ `types.ts`（`FuelRecord.deleted_at`）。
- **只对 `fuel_records` 加软删**（油耗与提醒核心）；mileage/maintenance 本期不删。

## 3. 读路径过滤（关键正确性）

以下函数全部加 `WHERE ... deleted_at IS NULL`，否则软删记录仍会污染结果：

| 函数 | 变更 |
|------|------|
| `getLastFuelRecord` | 加 `deleted_at IS NULL` |
| `getRecentFuelRecords` | 同上 |
| `getFuelRecordsByDateRange` | 同上 |
| `getLatestOdometer` | fuel 子查询加 `deleted_at IS NULL`（提醒不被删记录误触发） |

> 既有测试插入的记录 `deleted_at` 为 NULL，天然通过过滤，**零回归**。

## 4. 写函数（database.ts）

- `updateFuelRecord(db, id, fields)`：列白名单 `['date','odometer','liters','price_total','fuel_type','note']`，只为"提供了的字段"拼 `SET col = ?`，参数化绑定；无字段则不执行。
- `softDeleteFuelRecord(db, id, deletedAt)`：`UPDATE fuel_records SET deleted_at = ? WHERE id = ?`。

> 列名来自白名单常量（非用户输入），值全部 `.bind()` 参数化——无注入面。

## 5. 工具契约（tools.ts）

| 工具 | 参数 | 作用 |
|------|------|------|
| `update_last_fuel` | `vehicle?` + 任意可改字段（`date?,odometer?,liters?,price_total?,fuel_type?,note?`） | 改该车最近一条加油记录 |
| `delete_last_fuel` | `vehicle?` | 软删该车最近一条加油记录 |

实现：
1. `resolveVehicle(db, vehicle)`（not_found/ambiguous 走统一文案）。
2. `last = getLastFuelRecord(db, vehicleId)`；无 → "没有可修改/删除的加油记录"。
3. update：收集提供的字段；为空 → 提示要改什么（AC4）；否则 `updateFuelRecord`，回显新值（重新查一次或本地合并）。
4. delete：`softDeleteFuelRecord(last.id, today)`，回显被删记录（AC5）。

> 删除时间戳 `today`/`now`：工具层用 `new Date().toISOString()`（运行时真实时钟，非 Workflow 沙箱），或传入。tools 当前无注入约定，直接用 `new Date()` 即可（与 `agent.ts` 现有 `buildSystemPrompt` 用法一致）。

## 6. Prompt 影响

`buildSystemPrompt` 增最小规则：
- "用户要改最近一条加油记录（'上一条里程改成X''上次写错了，是9升'）用 update_last_fuel，只传要改的字段。"
- "用户要删最近一条（'删掉刚才那条''删除最近记录'）用 delete_last_fuel。"

## 7. 边界与错误处理

- 无可操作记录 → 明确提示（AC3/AC8）。
- update 无任何字段 → 提示要改什么（AC4），不空跑 SQL。
- 多车 not_found/ambiguous → 复用 spec 001 文案。
- 软删后 `getLatestOdometer` 排除该记录 → 误填高里程删掉后不再误触发提醒（AC5）。

## 8. 风险与权衡

| 风险 | 缓解 |
|------|------|
| 漏过滤某个读路径导致软删记录复现 | §3 清单逐一覆盖；测试断言删后查询/统计/last/odometer 均不含 |
| 动态 SET 拼接注入 | 列名白名单常量 + 值参数化绑定 |
| "最近一条"指代歧义 | 限定为该车 odometer 最大且未删的记录，单条操作 |
| 误删 | 软删可由运维恢复（`deleted_at` 置回 NULL） |

## 9. 测试要点（test/record-edit.test.ts）

- database：`updateFuelRecord` 改单/多字段、白名单外字段被忽略；`softDeleteFuelRecord` 后各读函数（last/recent/range/latestOdometer）均排除。
- tools：`update_last_fuel` AC1/AC2/AC3/AC4/AC7；`delete_last_fuel` AC5/AC6/AC8。
- 回归：未删记录的既有加油/统计/提醒测试不受影响。
