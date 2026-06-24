-- 迁移 0005：提醒自动续期（spec 006）
-- 前向一次性迁移：ALTER ADD COLUMN 非幂等（SQLite），重复执行报 "duplicate column" 即已迁移。
-- 全新数据库用 docs/schema.sql（已含 interval_km）。
-- 执行：本地 wrangler d1 execute moto-agent-db --local  --file=migrations/0005_reminder_interval.sql
--       线上 wrangler d1 execute moto-agent-db --remote --file=migrations/0005_reminder_interval.sql

ALTER TABLE reminders ADD COLUMN interval_km REAL;   -- 里程提醒续期间隔（NULL=一次性，不续期）
