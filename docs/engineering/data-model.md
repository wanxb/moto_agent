# 数据模型与演进

> D1（SQLite 兼容）。实现见 `schema.sql`、访问层 `src/database.ts`。改 schema **必须**遵守本文件的迁移纪律。

---

## 1. 当前 Schema

> 含 spec 001 多车管理（`vehicles` 表 + 记录表 `vehicle_id`）。以 `schema.sql` 为准。

```sql
-- 车辆（spec 001）
CREATE TABLE vehicles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,               -- 车名，如"小绿"
    is_default  INTEGER NOT NULL DEFAULT 0,     -- 1=默认车（同一时刻仅一辆）
    is_active   INTEGER NOT NULL DEFAULT 1,     -- 软删除预留
    user_id     INTEGER,                        -- Phase 3 多用户预留
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 加油记录
CREATE TABLE fuel_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,           -- ISO 8601: 2026-06-18
    odometer    REAL    NOT NULL,           -- 里程表读数 (km)
    liters      REAL    NOT NULL,           -- 加油量 (L)
    price_total REAL    NOT NULL,           -- 总价 (元)
    fuel_type   TEXT    NOT NULL DEFAULT '95',  -- 油品: 92/95/98
    note        TEXT,
    vehicle_id  INTEGER,                    -- 所属车辆（spec 001，存量数据可空）
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 纯里程记录（未加油的骑行，补全区间计算）
CREATE TABLE mileage_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    odometer    REAL    NOT NULL,
    note        TEXT,
    vehicle_id  INTEGER,                    -- 所属车辆（spec 001）
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_fuel_date       ON fuel_records(date);
CREATE INDEX idx_fuel_odometer   ON fuel_records(odometer);
CREATE INDEX idx_fuel_vehicle    ON fuel_records(vehicle_id);
CREATE INDEX idx_mileage_vehicle ON mileage_records(vehicle_id);
CREATE INDEX idx_vehicles_default ON vehicles(is_default);
```

> `vehicle_id` 可空：存量（pre-001）记录经 [迁移 0001](../../migrations/0001_multi_vehicle.sql) 回填到默认车；无任何车辆时记录保持 `vehicle_id=NULL`，按单车模式工作（[agent-design §2](agent-design.md)）。

> 注：PRD §6.1 曾设计 `price_per_l` 生成列，**实际实现未采用**——单价在工具层 `price_total / liters` 即时计算（见 `tools.ts`）。本文件以实际 `schema.sql` 为准。

---

## 2. 字段语义与约定

| 字段 | 类型 | 语义 | 约定 |
|------|------|------|------|
| `date` | TEXT | 业务日期 | ISO 8601 `YYYY-MM-DD`，字符串可比较排序 |
| `odometer` | REAL | 里程表读数 | **绝对值**，非区间；区间靠相邻记录相减 |
| `liters` | REAL | 本次加油量 | 用于"下一次"区间油耗计算（fill-to-fill） |
| `price_total` | REAL | 总价（元） | 单价 = `price_total/liters` 即时算，不落库 |
| `fuel_type` | TEXT | 油品标号 | 枚举 `92/95/98`，默认 `95` |
| `created_at` | TEXT | 记录写入时刻 | `datetime('now')`（UTC，注意时区，见 §6） |

---

## 3. 核心计算逻辑

```
区间里程 = 本次 odometer − 上次 odometer
区间油耗 (L/100km) = 上次加油量 liters / 区间里程 × 100
```

- 采用 **fill-to-fill（两次加满法）** 思想：用"上一次"的加油量除以"到这次"行驶的里程。
- 实现：`tools.ts` 的 `logFuel`（本次油耗）与 `queryStats`（区间汇总）。
- **排序基准是 `odometer` 而非 `date`**（见 `database.ts` 的 `ORDER BY odometer`）——里程单调递增，比日期更可靠（同日多次加油、补录历史等场景）。

> 已知局限：不强制"加满"标志，精度依赖用户尽量加满（见 [`../../PRD.md`](../../PRD.md) §11 开放问题）。

---

## 4. 访问层（database.ts）

纯 SQL，无业务逻辑。现有函数：

| 函数 | SQL 要点 |
|------|---------|
| `insertFuelRecord` | INSERT，`fuel_type` 默认 `'95'`，`note` 默认 NULL |
| `insertMileageRecord` | INSERT 里程 |
| `getLastFuelRecord` | `ORDER BY odometer DESC LIMIT 1` |
| `getRecentFuelRecords(limit)` | `ORDER BY odometer DESC LIMIT ?` |
| `getFuelRecordsByDateRange(s,e)` | `WHERE date BETWEEN ? AND ? ORDER BY odometer ASC` |

> 所有查询用**参数化绑定**（`.bind(...)`），防 SQL 注入。新增查询沿用此模式。

---

## 5. 迁移纪律（硬约束）

> **schema 只增不删。** 这是保护历史数据 + 向上兼容的不变量（[`../../CLAUDE.md`](../../CLAUDE.md) §7、[`../../PRD.md`](../../PRD.md) §9）。

**允许**：
- 新增表。
- 新增列（带 `DEFAULT`，保证旧行有值）。
- 新增索引。

**禁止**（除非走 ADR + 数据备份的重大迁移）：
- 删列、删表、改列类型、改列名。
- 破坏既有数据的约束变更。

### 迁移操作清单（每次改 schema）

1. 写迁移 SQL（`ALTER TABLE ... ADD COLUMN ...` 或 `CREATE TABLE`），**幂等**（`IF NOT EXISTS`）。
2. 更新 `schema.sql`（新库初始化用）。
3. **同步更新 `test/utils.ts` 的建表语句**（测试库与生产 schema 一致）。
4. 本地验证：`npm run db:init`（或对迁移 SQL 执行 `wrangler d1 execute --local`）。
5. 线上执行：`wrangler d1 execute moto-agent-db --remote --file=<迁移>.sql`。
6. 更新本文件 §1 与相关 spec。

> 迁移目录 `migrations/NNNN_*.sql` 已启用。已登记：
> | 迁移 | 内容 | 关联 |
> |------|------|------|
> | [`0001_multi_vehicle.sql`](../../migrations/0001_multi_vehicle.sql) | 多车管理：`vehicles` 表 + 记录表 `vehicle_id` + 存量回填默认车 | [spec 001](../specs/001-multi-vehicle/) |

---

## 6. 已知问题

| 问题 | 现状 | 影响 | 计划 |
|------|------|------|------|
| 时区 | `created_at` 用 `datetime('now')`（UTC） | 跨时区/边界日期可能错位 | Phase 2 统一时区策略 |
| 加满标志 | 无 | 油耗精度依赖用户加满 | 可选加 `is_full` 列（只增） |
| 修改/删除 | 无纠错功能 | 记错只能忍 | Phase 2 P2（[backlog](../specs/backlog.md)） |

---

## 7. 演进规划

| 阶段 | Schema 变更 | 说明 |
|------|------------|------|
| **Phase 2 多车** ✅ | 新增 `vehicles` 表；`fuel_records`/`mileage_records` 加 `vehicle_id` | 已实现，见 [迁移 0001](../../migrations/0001_multi_vehicle.sql) · [spec 001](../specs/001-multi-vehicle/design.md) |
| **Phase 2 维保** | 新增 `maintenance_records` 表（绑定 `vehicle_id`） | [backlog](../specs/backlog.md) |
| **Phase 3 多用户** | 新增 `users` 表（存 `chat_id`）；各表加 `user_id` | 数据隔离前提，需先做 [security](security.md) 设计 |
| **Phase 4** | 时序数据（OBD/GPS），可能引入独立存储 | 视数据量 |

> 演进时 `vehicle_id`/`user_id` 都用"带默认值的新增列"方式落地，保证存量单车/单用户数据零迁移成本。
