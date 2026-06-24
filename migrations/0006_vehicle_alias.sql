-- 迁移 0006：车辆别名（spec 009）
-- ALTER ADD COLUMN 非幂等（SQLite），重复执行报 "duplicate column" 即已迁移。
-- 全新数据库用 docs/schema.sql（已含 alias）。
-- 执行：本地 wrangler d1 execute moto-agent-db --local  --file=migrations/0006_vehicle_alias.sql
--       线上 wrangler d1 execute moto-agent-db --remote --file=migrations/0006_vehicle_alias.sql

ALTER TABLE vehicles ADD COLUMN alias TEXT;   -- 简称/别名，可空
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_alias ON vehicles(alias) WHERE alias IS NOT NULL;
