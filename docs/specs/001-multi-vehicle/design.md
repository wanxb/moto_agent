# 设计：多车管理

> 规格 001 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[architecture](../../engineering/architecture.md) · [data-model](../../engineering/data-model.md) · [agent-design](../../engineering/agent-design.md)

## 1. 方案概述

引入 `vehicles` 表表示车辆，给 `fuel_records`/`mileage_records` 加 `vehicle_id` 外键。新增车辆管理工具（添加/列出/设默认），并给现有记录与查询工具加可选的车辆维度。LLM 负责把用户说的车名解析成 `vehicle_id`（通过先查车辆列表）；未指明且有唯一默认车则用默认，多车歧义则反问。存量数据通过迁移自动归入一辆默认车，保证 [AC8](requirements.md#4-验收标准given--when--then) 零损失。

**不变量遵守**：schema 只增不删（[data-model](../../engineering/data-model.md) §5）；新能力通过新工具实现（[agent-design](../../engineering/agent-design.md) §2）；为多用户预留 `user_id`。

## 2. 数据模型变更

```sql
-- 新增：车辆表
CREATE TABLE IF NOT EXISTS vehicles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,                 -- 用户起的车名，如"小绿"
    is_default  INTEGER NOT NULL DEFAULT 0,       -- 1=默认车（同一时刻仅一辆为 1）
    is_active   INTEGER NOT NULL DEFAULT 1,       -- 软删除预留
    user_id     INTEGER,                          -- Phase 3 多用户预留，本期 NULL
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_default ON vehicles(is_default);

-- 现有表加车辆外键（带默认值，存量行回填默认车 id）
ALTER TABLE fuel_records    ADD COLUMN vehicle_id INTEGER;
ALTER TABLE mileage_records ADD COLUMN vehicle_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_fuel_vehicle    ON fuel_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_mileage_vehicle ON mileage_records(vehicle_id);
```

> SQLite 的 `ALTER TABLE ADD COLUMN` 不支持给已存在行设非默认回填值，故 `vehicle_id` 不带 NOT NULL；存量回填在**迁移脚本**里用 `UPDATE` 完成（§7）。

**同步更新**：`docs/schema.sql`（新库初始化要含 vehicles + vehicle_id 列）、`test/utils.ts`（测试建表语句加 vehicles + vehicle_id）。

### 默认车不变量

"同一时刻仅一辆 `is_default=1`"。设默认时在一个 D1 `batch` 内：先 `UPDATE vehicles SET is_default=0`，再 `UPDATE vehicles SET is_default=1 WHERE id=?`，保证原子。

## 3. 工具契约变更

新增 3 个工具，改造 3 个现有工具（[agent-design](../../engineering/agent-design.md) §2 规范）。

### 新增

| 工具 | 参数 | 作用 | 返回 |
|------|------|------|------|
| `add_vehicle` | `name`（必填） | 创建车辆；首辆自动设默认 | ✅ 已添加（含是否设默认） |
| `list_vehicles` | 无 | 列出全部活跃车辆 | 🏍 列表（标注默认） |
| `set_default_vehicle` | `name`（必填） | 切换默认车 | ✅ 已切换 |

### 改造（加可选 `vehicle` 名称参数）

| 工具 | 变更 |
|------|------|
| `log_fuel` | 加可选 `vehicle`（车名）。解析为 `vehicle_id`：指定→精确匹配；未指定→默认车；多车且无默认→返回"请指明车辆"让 LLM 反问 |
| `log_mileage` | 同上 |
| `query_stats` | 加可选 `vehicle`；过滤该车记录 |
| `get_last_record` | 加可选 `vehicle`；默认取默认车最近记录 |

> **车名 → vehicle_id 解析**统一抽一个内部 helper `resolveVehicle(db, name?)`：返回 `{id, name}` 或歧义信号。工具实现复用它，避免重复逻辑。

## 4. Prompt 影响

`agent.ts` 的 `buildSystemPrompt` 增加最小规则：

- "用户可能为多辆车记录。若消息提到车名，作为 `vehicle` 传入对应工具；未提到则不传（工具会用默认车）。"
- "若工具返回提示需要指明车辆，向用户反问是哪辆车。"
- "用户问'我有哪些车'用 `list_vehicles`；'添加车''设默认车'用对应工具。"

保持精简，具体匹配逻辑在工具实现里，不让 LLM 猜 id。

## 5. 数据访问层（database.ts）

新增纯 SQL 函数（参数化绑定）：

- `insertVehicle(name, isDefault)` → 返回新 id。
- `getVehicleByName(name)` → 精确名匹配活跃车。
- `listVehicles()` → 活跃车列表。
- `getDefaultVehicle()` → `WHERE is_default=1 AND is_active=1`。
- `setDefaultVehicle(id)` → batch：清零 + 置位（§2 不变量）。
- `countVehicles()` → 用于"首辆自动默认"判断。

改造现有函数加 `vehicleId` 过滤参数（可选）：`insertFuelRecord`、`insertMileageRecord`、`getLastFuelRecord`、`getRecentFuelRecords`、`getFuelRecordsByDateRange` 增加 `vehicle_id` 写入/`WHERE vehicle_id = ?` 过滤。

## 6. 流程 / 时序（记录加油，含车辆解析）

```
用户："小绿加了10升花98里程12580"
  → LLM 调 log_fuel{vehicle:"小绿", liters:10, price_total:98, odometer:12580}
     → resolveVehicle(db, "小绿")
         · getVehicleByName("小绿") 命中 → vehicle_id=1
     → insertFuelRecord(..., vehicle_id=1)
     → 取该车上次记录算油耗（getLastFuelRecord(vehicle_id=1)）
     → 返回 "✅ 已记录（小绿）…"

用户："加了10升…"（未指明，存在多车无默认）
  → log_fuel{liters:10,...}（无 vehicle）
     → resolveVehicle(db, undefined)
         · getDefaultVehicle() 无 → countVehicles()>1 → 返回歧义信号
     → 工具返回 "请指明记到哪辆车（你有：小绿、通勤车）"
  → LLM 反问用户
```

## 7. 迁移（存量数据，保证 AC8）

迁移脚本 `migrations/0001_multi_vehicle.sql`（幂等）：

```sql
-- 1. 建 vehicles 表 + 给记录表加 vehicle_id（见 §2）
-- 2. 若已有 fuel/mileage 记录但无车辆，创建一辆默认车
INSERT INTO vehicles (name, is_default)
SELECT '我的摩托', 1
WHERE NOT EXISTS (SELECT 1 FROM vehicles)
  AND (EXISTS (SELECT 1 FROM fuel_records) OR EXISTS (SELECT 1 FROM mileage_records));
-- 3. 回填存量记录到默认车
UPDATE fuel_records    SET vehicle_id = (SELECT id FROM vehicles WHERE is_default=1) WHERE vehicle_id IS NULL;
UPDATE mileage_records SET vehicle_id = (SELECT id FROM vehicles WHERE is_default=1) WHERE vehicle_id IS NULL;
```

执行：本地 `--local` 验证 → `--remote`（见 [observability-ops](../../engineering/observability-ops.md) §3.3）。验证统计结果与迁移前一致。

## 8. 边界与错误处理

- 车名不存在：`resolveVehicle` 返回未找到，工具回"没有找到车辆〈x〉，要先添加吗？"。
- 重复添加同名车：提示已存在，不重复建。
- 多车无默认且未指明：歧义反问（AC4），**不**默认猜第一辆。
- 单车场景：未指明自动用唯一车（即默认车），不反问，体验不退化。
- `odometer` 区间计算改为**按车**取上次记录，避免跨车里程相减（关键正确性点）。

## 9. 风险与权衡

| 风险 | 缓解 |
|------|------|
| 跨车里程相减导致油耗算错 | 所有"上次记录"查询都带 `vehicle_id` 过滤（§5） |
| LLM 车名指代错误 | 精确名匹配 + 歧义反问 + 回显车名（"已记录（小绿）"）让用户可发现 |
| 存量迁移破坏历史统计 | 迁移幂等 + 回填默认车 + 迁移后对比验证（AC8） |
| `vehicle_id` 可空导致漏过滤 | 迁移后所有记录都有 id；新写入强制带 id；测试覆盖 |

## 10. 测试要点

对照 [testing-strategy](../../engineering/testing-strategy.md)：
- `database.test.ts`：vehicles CRUD、默认车唯一性（batch 原子）、按 vehicle_id 过滤查询。
- `tools.test.ts`：add/list/set_default；log_fuel 三种解析路径（指定/默认/歧义）；按车统计；**跨车里程不相减**。
- 迁移测试：有存量数据 → 迁移 → 默认车创建 + 回填 + 统计一致（AC8）。
- 单车回归：未指明时不反问，行为同 MVP。
