-- 迁移 0009：多用户（spec 016）
-- 前向一次性迁移：
--   · CREATE TABLE / CREATE INDEX 带 IF NOT EXISTS，可安全重入。
--   · ALTER TABLE ADD COLUMN 无 IF NOT EXISTS（SQLite 限制），重复执行会报 "duplicate column"，属正常——表示已迁移过。
-- 全新数据库请直接用 docs/schema.sql（已含 users 表与各表 user_id），不要再跑本迁移。
-- 数据回填（存量数据归属管理员）见 scripts/migrate-single-user.ts；本迁移只动结构，不动数据。
-- 执行：本地 wrangler d1 execute moto-agent-db --local  --file=migrations/0009_multi_user.sql
--       线上 wrangler d1 execute moto-agent-db --remote --file=migrations/0009_multi_user.sql

-- 1. 用户表（账号主体；email / telegram_id 任一可空，UNIQUE 允许多个 NULL）
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    UNIQUE,                    -- 邮箱（PWA 用户必填，tg-only 用户暂空）
    telegram_id TEXT    UNIQUE,                    -- Telegram chat_id（tg 用户必填）
    nickname    TEXT,                              -- 昵称（可选）
    lang        TEXT    NOT NULL DEFAULT 'zh',     -- 语言偏好 'zh' | 'en'
    is_admin    INTEGER NOT NULL DEFAULT 0,        -- 1=管理员（存量数据迁移目标）
    status      TEXT    NOT NULL DEFAULT 'active', -- 'active' | 'merged'（账号合并后失活）
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT                               -- 最近登录时间
);

-- 2. 既有表补 user_id（直接列隔离，不靠 vehicle JOIN；vehicles 已有 user_id 列）
--    reminders.user_id 仅作归属；chat_id 保持「推送目标」原义不变（cron 直接拿它 sendMessage）。
ALTER TABLE fuel_records        ADD COLUMN user_id INTEGER;
ALTER TABLE mileage_records     ADD COLUMN user_id INTEGER;
ALTER TABLE maintenance_records ADD COLUMN user_id INTEGER;
ALTER TABLE reminders           ADD COLUMN user_id INTEGER;

-- 3. user_id 索引（隔离查询走 user_id = ?）
CREATE INDEX IF NOT EXISTS idx_fuel_user      ON fuel_records(user_id);
CREATE INDEX IF NOT EXISTS idx_mileage_user   ON mileage_records(user_id);
CREATE INDEX IF NOT EXISTS idx_maint_user     ON maintenance_records(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_user  ON vehicles(user_id);
