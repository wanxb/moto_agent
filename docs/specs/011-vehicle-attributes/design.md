# Spec 011 — 车辆属性扩展 设计文档

| 字段 | 内容 |
|------|------|
| **Spec** | 011 |
| **需求** | [requirements.md](requirements.md) |
| **任务** | [tasks.md](tasks.md) |
| **约束来源** | [data-model.md](../../engineering/data-model.md)、[agent-design.md](../../engineering/agent-design.md)、Spec 001/009 |

---

## 1. 方案概述

给 `vehicles` 表增加 5 个可选属性列（品牌/型号/油号/油箱容量/颜色）。扩展 `add_vehicle`、新增 `update_vehicle` 工具，修改 `log_fuel` 实现默认油号和油号自动更新。

## 2. 数据模型

### 2.1 Migration（0007）

```sql
ALTER TABLE vehicles ADD COLUMN brand         TEXT;
ALTER TABLE vehicles ADD COLUMN model         TEXT;
ALTER TABLE vehicles ADD COLUMN fuel_type     TEXT;
ALTER TABLE vehicles ADD COLUMN tank_capacity REAL;
ALTER TABLE vehicles ADD COLUMN color         TEXT;
```

全部可空，不设索引（查询过滤场景少）。

### 2.2 同步更新
- `docs/schema.sql`：vehicles 表定义加 5 列
- `test/utils.ts`：`initDB` 的 vehicles 建表语句加 5 列
- `src/types.ts`：`Vehicle` 接口加 5 个可选字段

## 3. 数据访问层

### 3.1 `updateVehicle(db, id, fields)`

```typescript
const ALLOWED_COLUMNS = ['brand', 'model', 'fuel_type', 'tank_capacity', 'color'];

async function updateVehicle(db: D1Database, id: number, fields: Partial<Pick<Vehicle, 'brand'|'model'|'fuel_type'|'tank_capacity'|'color'>>): Promise<void> {
  const entries = Object.entries(fields).filter(([k]) => ALLOWED_COLUMNS.includes(k));
  if (!entries.length) return;
  const setClauses = entries.map(([k]) => `${k} = ?`);
  const values = entries.map(([, v]) => v ?? null);
  const sql = `UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = ?`;
  await db.prepare(sql).bind(...values, id).run();
}
```

白名单防注入。空字符串 → null。

### 3.2 `getVehicleMostUsedFuelType(db, vehicleId)`

```sql
SELECT fuel_type, COUNT(*) AS cnt
FROM fuel_records
WHERE vehicle_id = ? AND deleted_at IS NULL
GROUP BY fuel_type
ORDER BY date DESC
LIMIT 5
```

取最近 5 条，返回出现次数最多的 fuel_type 及其次数。无记录时返回 null。

## 4. 工具层

### 4.1 修改 `add_vehicle`

JSON Schema `parameters.properties` 增加：
```json
{
  "brand": { "type": "string", "description": "品牌" },
  "model": { "type": "string", "description": "型号" },
  "fuel_type": { "type": "string", "enum": ["92", "95", "98"], "description": "默认油号" },
  "tank_capacity": { "type": "number", "description": "油箱容量(L)" },
  "color": { "type": "string", "description": "颜色" }
}
```

`required` 不变（仅 `name`）。`execute` 中将新字段传入 `insertVehicle`。

### 4.2 新增 `update_vehicle`

- 参数：`name`（必填）+ 5 个可选属性
- `execute`：`resolveVehicle` → 校验至少传了一个属性 → `updateVehicle`
- 返回中文确认文案（如 "✅ 小绿 已更新：型号 → CBF190X，颜色 → 红色"）
- 空字符串当作清空处理

### 4.3 修改 `log_fuel`

**默认油号**（在 `execute` 开头、`resolveVehicle` 之后）：
```typescript
if (!fuel_type && resolution.status === 'resolved' && resolution.vehicle.fuel_type) {
  fuel_type = resolution.vehicle.fuel_type;
}
```

**自动更新**（在 `insertFuelRecord` 之后，仅当 vehicle 解析成功时）：
```typescript
const mostUsed = await getVehicleMostUsedFuelType(db, vehicle.id);
if (mostUsed && mostUsed.count >= 3 && vehicle.fuel_type !== mostUsed.fuel_type) {
  await updateVehicle(db, vehicle.id, { fuel_type: mostUsed.fuel_type });
  console.log(`[tool] auto-updated ${vehicle.name} fuel_type: ${vehicle.fuel_type} → ${mostUsed.fuel_type}`);
}
```

## 5. Prompt

在 system prompt 中添加一行（保持简洁）：
```
记录加油时如用户未提油号，使用车辆属性中的默认油号（无则默认 95）。
```

不做大改——工具 description 已经包含行为描述，LLM 会自行推理。

## 6. Dashboard API

`/api/v1/vehicles` 的 `VehicleInfo` 接口增加 `brand`, `model`, `fuel_type`, `tank_capacity`, `color`。SQL 查询已 SELECT *，无需改 SQL。

## 7. 测试策略

| 文件 | 测试内容 |
|------|---------|
| `test/vehicle-attributes.test.ts` | add_vehicle 带新属性、add_vehicle 不带新属性（回归）、update_vehicle 各字段、update_vehicle 清空、update_vehicle 未知车、log_fuel 默认油号（车辆有/无）、log_fuel 油号自动更新（达到/未达到阈值）、getVehicleMostUsedFuelType 正确性 |
| 现有测试 | 全部通过（新列可空，不影响旧插入逻辑） |

约 12-15 个新测试。
