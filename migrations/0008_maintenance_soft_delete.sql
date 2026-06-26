-- 迁移 0008：维保记录软删除（spec 017）
-- 前向一次性迁移：ALTER ADD COLUMN 非幂等（SQLite 限制），重复执行报 "duplicate column" 即表示已迁移。
-- 全新数据库用 docs/schema.sql（已含 deleted_at）。
-- 执行：本地 wrangler d1 execute moto-agent-db --local  --file=migrations/0008_maintenance_soft_delete.sql
--       线上 wrangler d1 execute moto-agent-db --remote --file=migrations/0008_maintenance_soft_delete.sql

ALTER TABLE maintenance_records ADD COLUMN deleted_at TEXT;   -- NULL=活跃；非空=软删除时刻
CREATE INDEX IF NOT EXISTS idx_maint_deleted ON maintenance_records(deleted_at);
