# 设计：车辆别名

> 规格 009 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[data-model](../../engineering/data-model.md) · [agent-design](../../engineering/agent-design.md) · 改造 [spec 001](../001-multi-vehicle/design.md)

## 1. 方案概述

`vehicles` 表加 `alias TEXT`（可空、唯一）。`resolveVehicle` 的匹配扩展为搜索 **`name` 或 `alias`**（新增 `getVehicleByNameOrAlias`）。列表显示时追加别名。别名对 LLM 透明（`resolveVehicle` 的返回不变——仍是 `{id, name}`，LLM 不感知别名），用户说的、工具传的 `vehicle` 参数是别名或全名，resolve 层自动归一。

**无破坏性变更**：存量车辆 `alias` 为 NULL，匹配逻辑新增 OR 分支只增加命中路径、不影响现有行为。

## 2. 数据模型

```sql
ALTER TABLE vehicles ADD COLUMN alias TEXT;   -- 别名/简称（可空，与 name 同样唯一约束）
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_alias ON vehicles(alias) WHERE alias IS NOT NULL;
```

- `alias` 可空（没有别名时用全名）。
- 唯一索引：`WHERE alias IS NOT NULL` 保证两辆车不会重别名，但不约束 NULL。
- 迁移 `migrations/0006_vehicle_alias.sql`（前向一次性 ALTER + 索引）。
- 同步 `schema.sql`、`test/utils.ts`、`types.ts`（`Vehicle.alias`）。

## 3. 数据访问层

- `getVehicleByNameOrAlias(db, nameOrAlias)`：`SELECT * FROM vehicles WHERE (name = ? OR alias = ?) AND is_active = 1 LIMIT 1`。取代各处 `getVehicleByName` 作为用户侧匹配入口。
- **保留** `getVehicleByName` 不变（内部仍按精确 name 取车——`rename_vehicle` 的重名校验等内部逻辑不应把别名当全名冲突）。

## 4. 工具层改造

### resolveVehicle（核心）
`resolveVehicle(db, name?)` 中的"指定车名"路径：`getVehicleByName` → `getVehicleByNameOrAlias`。其余路径（默认车/单车/无车/歧义）不变。

### 调用点（每个工具的 vehicle 解析均经 `resolveVehicle`，零散改一处即可）
现有所有带 `vehicle` 参数的工具都走 `resolveVehicle` → 自动获得别名识别，**无需逐个改**。

### 列表显示
`list_vehicles`：现有 `v.name` → `v.name + (v.alias ? `（${v.alias}）` : '')`。例如输出：`• Honda NS125LA（小拉）（默认）`。

### 新增工具
| 工具 | 参数 | 作用 |
|------|------|------|
| `set_vehicle_alias` | `name`（全名）, `alias`（新简称；传空字符串""表示移除） | 设/改/删除别名 |

实现：
1. `getVehicleByName(db, name)` 找车 → 不存在则"没有找到车辆「name」"。
2. 若 `alias` 非空：`getVehicleByNameOrAlias(db, alias)` 查重 → 命中且不是自身 → "已存在车辆（或别名）「alias」，换个简称"。
3. `UPDATE vehicles SET alias = ? WHERE id = ?`（空串→NULL）。
4. 回复：别名→"✅ 已将「name」的简称设为「alias」"；移除→"✅ 已移除「name」的简称"。

### rename_vehicle
`rename_vehicle` 只改 `name`，不改 `alias`（AC6：互不影响）。

### 默认车设置/取消
`cancel_reminder` 等不涉及车名匹配的工具不受影响。`set_default_vehicle` 的入参 `name` 也可通过别名匹配——改 `resolveVehicle` 后自动生效（其不到达此函数：`setDefaultVehicleTool` 用 `getVehicleByName` 精确匹配全名——但用户应该说"默认车设成小拉"也行，用别名设默认车）。修正：`setDefaultVehicleTool` 的查找也改用 `getVehicleByNameOrAlias`。同理 `cancel_reminder` 不走 resolve 是直接 getVehicleByName，但 cancel 按 type 匹配、不涉及改名。

**需要手动改的调用点**：`setDefaultVehicleTool`、`renameVehicleTool`（原始名查找，别名→全名应能找到）。

## 5. Prompt

无需改——别名对 LLM 完全透明。LLM 传给工具的 `vehicle` 参数可以是全名或别名，resolve 层归一，LLM 不需要知道别名存在。

## 6. 测试要点

- database：`getVehicleByNameOrAlias`；别名唯一索引；别名查询不跨车混淆。
- tools：`set_vehicle_alias`（设/改/移除/重名拒绝）；别名指代（AC2/AC3 AC7）；列表显示别名（AC5）；改名不改别名（AC6）。
- 回归：既有车辆相关测试（`vehicles.test.ts`）不受影响（别名 NULL 时行为不变）。
