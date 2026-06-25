-- 全新数据库初始化。已有库的演进走 migrations/ 顺序迁移（见 docs/engineering/data-model.md §5）。

-- 车辆表（spec 001 多车管理）
CREATE TABLE IF NOT EXISTS vehicles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    alias       TEXT,                            -- 简称/别名（spec 009，可空）
    brand       TEXT,                            -- 品牌（spec 011）
    model       TEXT,                            -- 型号（spec 011）
    fuel_type   TEXT,                            -- 默认油号（spec 011）
    tank_capacity REAL,                          -- 油箱容量 L（spec 011）
    color       TEXT,                            -- 颜色（spec 011）
    is_default  INTEGER NOT NULL DEFAULT 0,       -- 1=默认车（同一时刻仅一辆为 1）
    is_active   INTEGER NOT NULL DEFAULT 1,       -- 软删除预留
    user_id     INTEGER,                          -- Phase 3 多用户预留
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_default ON vehicles(is_default);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_alias ON vehicles(alias) WHERE alias IS NOT NULL;

CREATE TABLE IF NOT EXISTS fuel_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,
    odometer    REAL    NOT NULL,
    liters      REAL    NOT NULL,
    price_total REAL    NOT NULL,
    fuel_type   TEXT    NOT NULL DEFAULT '95',
    note        TEXT,
    vehicle_id  INTEGER,                          -- 所属车辆（spec 001）
    deleted_at  TEXT,                             -- 软删除时刻（spec 004，NULL=活跃）
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

-- 定时提醒（spec 003）
CREATE TABLE IF NOT EXISTS reminders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id       INTEGER,
    type             TEXT    NOT NULL,              -- 机油/保险/年检…
    mode             TEXT    NOT NULL,              -- 'mileage' | 'date'
    trigger_odometer REAL,
    trigger_date     TEXT,
    interval_km      REAL,                          -- 里程续期间隔（spec 006，NULL=一次性）
    note             TEXT,
    chat_id          TEXT,                          -- 推送目标（空→用 ALLOWED_CHAT_ID）
    status           TEXT    NOT NULL DEFAULT 'active',
    fired_at         TEXT,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fuel_date     ON fuel_records(date);
CREATE INDEX IF NOT EXISTS idx_fuel_odometer ON fuel_records(odometer);
CREATE INDEX IF NOT EXISTS idx_fuel_vehicle    ON fuel_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_mileage_vehicle ON mileage_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maint_vehicle   ON maintenance_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maint_type      ON maintenance_records(type);
CREATE INDEX IF NOT EXISTS idx_reminders_status  ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_vehicle ON reminders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fuel_deleted      ON fuel_records(deleted_at);

-- 知识库 RAG（spec 015）
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_text   TEXT    NOT NULL,
    source_doc   TEXT    NOT NULL,
    section_title TEXT,
    chunk_index  INTEGER NOT NULL,
    topics       TEXT,
    doc_hash     TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_chunks(source_doc);
