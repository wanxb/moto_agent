-- 迁移 0003：定时提醒（spec 003）
-- 纯新增表，可重入（IF NOT EXISTS）。依赖 spec 001 vehicle_id。
-- 执行：本地 wrangler d1 execute moto-agent-db --local  --file=migrations/0003_reminders.sql
--       线上 wrangler d1 execute moto-agent-db --remote --file=migrations/0003_reminders.sql

CREATE TABLE IF NOT EXISTS reminders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id       INTEGER,                          -- 所属车辆（spec 001）
    type             TEXT    NOT NULL,                 -- 机油/保险/年检…（标签）
    mode             TEXT    NOT NULL,                 -- 'mileage' | 'date'
    trigger_odometer REAL,                             -- mileage 模式：目标里程
    trigger_date     TEXT,                             -- date 模式：ISO 日期
    note             TEXT,
    chat_id          TEXT,                             -- 推送目标（多用户预留；空→用 ALLOWED_CHAT_ID）
    status           TEXT    NOT NULL DEFAULT 'active',-- 'active' | 'done'
    fired_at         TEXT,                             -- 触发推送时刻
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reminders_status  ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_vehicle ON reminders(vehicle_id);
