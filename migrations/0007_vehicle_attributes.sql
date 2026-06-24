-- 迁移 0007：车辆属性扩展（spec 011）
-- vehicles 表增加品牌、型号、默认油号、油箱容量、颜色
-- ALTER ADD COLUMN 非幂等（SQLite），重复执行报 "duplicate column" 即已迁移。
-- 全新数据库用 docs/schema.sql（已含这些列）。
-- 执行：本地 wrangler d1 execute moto-agent-db --local  --file=migrations/0007_vehicle_attributes.sql
--       线上 wrangler d1 execute moto-agent-db --remote --file=migrations/0007_vehicle_attributes.sql

ALTER TABLE vehicles ADD COLUMN brand         TEXT;   -- 品牌（本田/雅马哈/…），可空
ALTER TABLE vehicles ADD COLUMN model         TEXT;   -- 型号（CBF190/巧格/…），可空
ALTER TABLE vehicles ADD COLUMN fuel_type     TEXT;   -- 默认油号（92/95/98），可空
ALTER TABLE vehicles ADD COLUMN tank_capacity REAL;   -- 油箱容量（L），可空
ALTER TABLE vehicles ADD COLUMN color         TEXT;   -- 颜色，可空
