# 设计：重复录入软拦截 + 删除扩展

> 规格 017 · [requirements.md](requirements.md) · [tasks.md](tasks.md)

## 1. 总体思路

复用 spec 004 的 fuel 软删除模式，把同一套搬到 `maintenance_records`，并在写入/删除两端加「确认」层。确认不用额外状态机——靠 LLM `confirm` 参数两段式 + KV 会话历史承接确认轮。

## 2. 数据模型（迁移 0008）

`maintenance_records` 加 `deleted_at TEXT`（NULL=活跃）+ `idx_maint_deleted` 索引。只加列加索引，向上兼容。同步 `docs/schema.sql`、`test/utils.ts`、`src/types.ts`（`MaintenanceRecord.deleted_at`）。

## 3. 数据访问层（`src/database.ts`）

- `getMaintenanceRecords()`：WHERE 加 `deleted_at IS NULL`（`getLastMaintenanceByType` 继承）。
- `softDeleteMaintenanceRecord(id, deletedAt)`：镜像 `softDeleteFuelRecord`。
- `findMaintenanceRecords({vehicleId, type?, date?})`：定位活跃记录，**date ASC, id ASC 正序**（最早在前，便于 keep_one 保留最早）。
- `findFuelRecords({vehicleId, date?, odometer?})`：任意加油定位；未给 date/odometer 时返回空数组（防止误把全部当候选）。

## 4. 去重软拦截（写入工具）

`log_fuel` / `log_maintenance` 加 `confirm?: boolean`。`confirm !== true` 时写入前探测：
- 加油：`findFuelRecords({vehicleId, date})` 中存在 `|Δodometer| ≤ FUEL_DUP_KM_THRESHOLD` → 返回 `dup.fuel_warn`，不写。
- 保养：`findMaintenanceRecords({vehicleId, type})` 中存在 `daysBetween(date) ≤ MAINT_DUP_DAYS` → 返回 `dup.maint_warn`，不写。

阈值集中在 `src/config.ts`。不硬阻断、不静默丢弃——`confirm=true` 即放行。

## 5. 删除工具（两段式 `confirm`，软删除）

统一模式：定位 → `confirm !== true` 回显预览不删 → `confirm=true` 软删 + 回显 + 恢复提示。

| 工具 | 定位 | 特殊分支 |
|------|------|---------|
| `delete_last_fuel`（改） | 该车最近一条 | — |
| `delete_fuel`（新） | `findFuelRecords(date/odometer)` | 0 条→未找到；>1→列出缩小范围 |
| `delete_maintenance`（新） | `findMaintenanceRecords(type/date)` | 0→未找到；1→预览删；>1 且 `keep_one`→保留最早删其余；>1 非 keep_one→列出缩小范围 |

`keep_one` 解决「两条几乎相同、无法靠属性区分」的去重：升序取 `slice(1)` 软删，保留最早。

## 6. Prompt / i18n

- `src/prompts.ts`（zh+en）：新增删除两步确认规则、去重转达规则；renumber 后续规则。
- `src/i18n/{zh,en}.ts`：`dup.*` / `delete.*` 成对键，占位 `{0}`。

## 7. 确认流程时序

```
轮1：用户"删掉那条保养" → LLM 调 delete_maintenance(无 confirm) → 工具返回预览 → 回复用户 → 预览进 KV history
轮2：用户"确认" → history 含预览 → LLM 调 delete_maintenance(confirm=true) → 软删 → 回复
```

物理保证：`confirm` 缺失时工具不执行删除，即使 LLM 误判也不会误删。

## 8. 测试

`test/maintenance.test.ts`：软删过滤、log 去重（拦截/确认/异类型不拦）、delete 两步、keep_one、多条歧义、未找到。
`test/tools.test.ts`：加油去重（拦截/确认/远里程不拦）、delete_last_fuel 两步、delete_fuel 定位删除/未找到。LLM mock，DB 走 initDB/clearDB。

## 9. 风险

- 自然语言定位误删 → 两段式 confirm + 预览回显 + 软删可恢复三重兜底。
- 阈值过紧/过松 → 集中 config 可调。
