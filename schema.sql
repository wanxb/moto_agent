-- 全新数据库初始化。已有库的演进走 migrations/ 顺序迁移（见 docs/engineering/data-model.md §5）。

-- 车辆表（spec 001 多车管理）
CREATE TABLE IF NOT EXISTS vehicles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,       -- 1=默认车（同一时刻仅一辆为 1）
    is_active   INTEGER NOT NULL DEFAULT 1,       -- 软删除预留
    user_id     INTEGER,                          -- Phase 3 多用户预留
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_default ON vehicles(is_default);

CREATE TABLE IF NOT EXISTS fuel_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    odometer    REAL    NOT NULL,
    liters      REAL    NOT NULL,
    price_total REAL    NOT NULL,
    fuel_type   TEXT    NOT NULL DEFAULT '95',
    note        TEXT,
    vehicle_id  INTEGER,                          -- 所属车辆（spec 001）
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mileage_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    odometer    REAL    NOT NULL,
    note        TEXT,
    vehicle_id  INTEGER,                          -- 所属车辆（spec 001）
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 维修保养记录（spec 002）
CREATE TABLE IF NOT EXISTS maintenance_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    type        TEXT    NOT NULL,               -- 机油/轮胎/保险/刹车/链条/其他
    odometer    REAL,                           -- 里程（可空）
    cost        REAL,                           -- 费用（可空）
    note        TEXT,
    vehicle_id  INTEGER,                        -- 所属车辆（spec 001）
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fuel_date     ON fuel_records(date);
CREATE INDEX IF NOT EXISTS idx_fuel_odometer ON fuel_records(odometer);
CREATE INDEX IF NOT EXISTS idx_fuel_vehicle    ON fuel_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_mileage_vehicle ON mileage_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maint_vehicle   ON maintenance_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maint_type      ON maintenance_records(type);
