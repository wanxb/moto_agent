# 设计：维修保养记录

> 规格 002 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[data-model](../../engineering/data-model.md) · [agent-design](../../engineering/agent-design.md) · 复用 [spec 001](../001-multi-vehicle/design.md) 的车辆解析

## 1. 方案概述

新增 `maintenance_records` 表（绑定 `vehicle_id`），新增 `log_maintenance` / `query_maintenance` 两个工具。车辆解析**直接复用** spec 001 已实现的 `resolveVehicle(db, name?)` helper（指定/默认/歧义/无车回退），不重复造轮子。保养类型用自由文本（常见值在工具描述里列举引导），里程与费用可空（保险等无里程场景）。

**不变量遵守**：schema 只增不删（[data-model §5](../../engineering/data-model.md)）；新能力 = 新工具（[agent-design §2](../../engineering/agent-design.md)）。

## 2. 数据模型变更

```sql
CREATE TABLE IF NOT EXISTS maintenance_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,           -- ISO 8601
    type        TEXT    NOT NULL,           -- 机油/轮胎/保险/刹车/链条/其他（自由文本）
    odometer    REAL,                       -- 里程（可空：保险等无里程）
    cost        REAL,                       -- 费用（可空）
    note        TEXT,
    vehicle_id  INTEGER,                    -- 所属车辆（复用 spec 001）
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_maint_vehicle ON maintenance_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maint_type    ON maintenance_records(type);
```

- 迁移：`migrations/0002_maintenance.sql`（`CREATE TABLE IF NOT EXISTS`，纯新增、可重入）。
- 同步：`schema.sql` 加表；`test/utils.ts` `initDB` 加建表、`clearDB` 加 `DELETE FROM maintenance_records`。
- 排序基准：有 `odometer` 用 odometer DESC，否则 date DESC。简化实现统一按 `date DESC, id DESC`（保养通常按时间看；里程可空，date 必填更稳）。

## 3. 工具契约变更

| 工具 | 参数 | 作用 | 返回 |
|------|------|------|------|
| `log_maintenance` | `date`（默认今天）, `type`（必填）, `odometer?`, `cost?`, `note?`, `vehicle?` | 记录一次保养 | ✅ 已记录保养 |
| `query_maintenance` | `vehicle?`, `type?`（按类型过滤）, `last_only?`（仅最近一条） | 查询保养历史 / 某类型最近一次 | 🔧 历史 / 最近一次 |

- `type` 描述列举常见值（机油/轮胎/保险/刹车/链条/其他）引导 LLM，但接受自由文本。
- `query_maintenance` 的 `type` 过滤用**相等优先 + 包含兜底**（"机油" 命中 "机油"；用户问"换机油"时 LLM 应抽出 type="机油"）。
- `last_only=true` 对应 US3（"上次换机油"）。

## 4. Prompt 影响

`agent.ts buildSystemPrompt` 增最小规则：
- "用户记录保养（换机油/轮胎/保险等）用 log_maintenance，抽取类型、里程、费用、日期；里程/费用没说就不传。"
- "查询保养历史用 query_maintenance；问'上次换 X'时传 type=X 且 last_only=true。"
- 车辆规则沿用 spec 001（已在 prompt 中）。

## 5. 数据访问层（database.ts）

新增（参数化绑定）：
- `insertMaintenanceRecord(db, { date, type, odometer?, cost?, note?, vehicle_id? })`
- `getMaintenanceRecords(db, { vehicleId?, type?, limit? })` → 按 `date DESC, id DESC`，可按车/类型过滤。
- `getLastMaintenanceByType(db, type, vehicleId?)` → 某类型最近一条（= `getMaintenanceRecords` limit 1 的便捷封装，或独立查询）。

> 复用 spec 001 的车辆过滤模式：`vehicleId === undefined` 时不按车过滤（兼容单车）。

## 6. 流程

```
"换机油 里程 13000 花了 80"
 → log_maintenance{type:"机油", odometer:13000, cost:80}（无 vehicle）
   → resolveVehicle(db) → 默认车 小绿
   → insertMaintenanceRecord({..., vehicle_id: 小绿.id})
   → "✅ 已记录保养（小绿）\n🔧 机油 · 13,000 km · ¥80 · 2026-06-24"

"上次换机油"
 → query_maintenance{type:"机油", last_only:true}
   → resolveVehicle → 默认车
   → getLastMaintenanceByType("机油", 小绿.id)
   → "🔧 最近一次「机油」（小绿）\n2026-06-24 · 13,000 km · ¥80"
```

## 7. 边界与错误处理

- 车辆解析的 not_found / ambiguous → 复用 spec 001 的反问文案（统一 helper）。
- `odometer`/`cost` 缺省 → 显示 `—`。
- 查询无记录 → "暂无保养记录"（带车名/类型上下文）。
- `type` 必填：LLM 没给类型时由 prompt 要求先澄清（不在工具层硬塞默认）。

## 8. 风险与权衡

| 风险 | 缓解 |
|------|------|
| 保养类型自由文本导致"上次换机油"匹配不到 | 工具描述引导常见枚举；查询用相等优先 + 包含兜底；回显让用户可发现 |
| 里程可空削弱与提醒（003）的衔接 | 本期允许空；003 设计提醒时对"无里程保养"单独处理（按日期周期） |
| 与加油记录的里程基准混淆 | 保养表独立，不参与油耗计算；仅自身历史 |

## 9. 测试要点

对照 [testing-strategy](../../engineering/testing-strategy.md)，新增 `test/maintenance.test.ts`：
- database：插入 + 按车过滤 + 按类型过滤 + 最近一条排序。
- tools：log_maintenance 默认车/指定车/无里程（AC1–AC3）；query_maintenance 历史/按类型 last_only（AC4–AC5）；歧义反问复用（AC6）。
- 回归：不影响加油/油耗相关既有测试。
