-- 迁移 0002：维修保养记录（spec 002）
-- 纯新增表，可重入（IF NOT EXISTS）。依赖 spec 001 的 vehicle_id 维度。
-- 执行：本地 wrangler d1 execute moto-agent-db --local  --file=migrations/0002_maintenance.sql
--       线上 wrangler d1 execute moto-agent-db --remote --file=migrations/0002_maintenance.sql

CREATE TABLE IF NOT EXISTS maintenance_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,           -- ISO 8601
    type        TEXT    NOT NULL,           -- 机油/轮胎/保险/刹车/链条/其他（自由文本）
    odometer    REAL,                       -- 里程（可空：保险等无里程）
    cost        REAL,                       -- 费用（可空）
    note        TEXT,
    vehicle_id  INTEGER,                    -- 所属车辆（spec 001）
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_maint_vehicle ON maintenance_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maint_type    ON maintenance_records(type);
