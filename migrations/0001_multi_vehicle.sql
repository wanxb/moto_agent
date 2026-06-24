-- 迁移 0001：多车管理（spec 001）
-- 前向一次性迁移：对「存量（pre-001、无 vehicle_id）」数据库执行一次。
--   · CREATE TABLE / CREATE INDEX 带 IF NOT EXISTS，可安全重入。
--   · ALTER TABLE ADD COLUMN 无 IF NOT EXISTS（SQLite 限制），重复执行会报 "duplicate column"，属正常——表示已迁移过。
--   · 数据回填（INSERT/UPDATE）带 WHERE 守卫，重入安全。
-- 全新数据库请直接用 schema.sql（已含 vehicle_id），不要再跑本迁移。
-- 执行：本地 wrangler d1 execute moto-agent-db --local  --file=migrations/0001_multi_vehicle.sql
--       线上 wrangler d1 execute moto-agent-db --remote --file=migrations/0001_multi_vehicle.sql

-- 1. 车辆表
CREATE TABLE IF NOT EXISTS vehicles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,                 -- 用户起的车名，如"小绿"
    is_default  INTEGER NOT NULL DEFAULT 0,       -- 1=默认车（同一时刻仅一辆为 1）
    is_active   INTEGER NOT NULL DEFAULT 1,       -- 软删除预留
    user_id     INTEGER,                          -- Phase 3 多用户预留，本期 NULL
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_default ON vehicles(is_default);

-- 2. 记录表加车辆外键（可空：SQLite 不支持给已存在行设非默认回填值，回填在步骤 3 完成）
ALTER TABLE fuel_records    ADD COLUMN vehicle_id INTEGER;
ALTER TABLE mileage_records ADD COLUMN vehicle_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_fuel_vehicle    ON fuel_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_mileage_vehicle ON mileage_records(vehicle_id);

-- 3. 若已有记录但无车辆，创建一辆默认车并回填存量记录（保证 AC8：迁移前后统计一致）
INSERT INTO vehicles (name, is_default)
SELECT '我的摩托', 1
WHERE NOT EXISTS (SELECT 1 FROM vehicles)
  AND (EXISTS (SELECT 1 FROM fuel_records) OR EXISTS (SELECT 1 FROM mileage_records));

UPDATE fuel_records
   SET vehicle_id = (SELECT id FROM vehicles WHERE is_default = 1 LIMIT 1)
 WHERE vehicle_id IS NULL
   AND EXISTS (SELECT 1 FROM vehicles WHERE is_default = 1);

UPDATE mileage_records
   SET vehicle_id = (SELECT id FROM vehicles WHERE is_default = 1 LIMIT 1)
 WHERE vehicle_id IS NULL
   AND EXISTS (SELECT 1 FROM vehicles WHERE is_default = 1);
