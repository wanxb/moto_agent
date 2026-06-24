import { FuelRecord, Vehicle } from './types';

// ── Fuel / mileage records ────────────────────────────────────────────────────

export async function insertFuelRecord(db: D1Database, data: {
  date: string; odometer: number; liters: number;
  price_total: number; fuel_type?: string; note?: string; vehicle_id?: number | null;
}): Promise<void> {
  await db.prepare(
    'INSERT INTO fuel_records (date, odometer, liters, price_total, fuel_type, note, vehicle_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    data.date, data.odometer, data.liters, data.price_total,
    data.fuel_type ?? '95', data.note ?? null, data.vehicle_id ?? null
  ).run();
}

export async function insertMileageRecord(db: D1Database, data: {
  date: string; odometer: number; note?: string; vehicle_id?: number | null;
}): Promise<void> {
  await db.prepare(
    'INSERT INTO mileage_records (date, odometer, note, vehicle_id) VALUES (?, ?, ?, ?)'
  ).bind(data.date, data.odometer, data.note ?? null, data.vehicle_id ?? null).run();
}

// vehicleId 省略 → 不按车过滤（兼容单车/历史数据）；提供 → 仅该车记录。
export async function getLastFuelRecord(db: D1Database, vehicleId?: number): Promise<FuelRecord | null> {
  if (vehicleId === undefined) {
    return db.prepare('SELECT * FROM fuel_records ORDER BY odometer DESC LIMIT 1').first<FuelRecord>();
  }
  return db.prepare('SELECT * FROM fuel_records WHERE vehicle_id = ? ORDER BY odometer DESC LIMIT 1')
    .bind(vehicleId).first<FuelRecord>();
}

export async function getRecentFuelRecords(db: D1Database, limit: number, vehicleId?: number): Promise<FuelRecord[]> {
  const stmt = vehicleId === undefined
    ? db.prepare('SELECT * FROM fuel_records ORDER BY odometer DESC LIMIT ?').bind(limit)
    : db.prepare('SELECT * FROM fuel_records WHERE vehicle_id = ? ORDER BY odometer DESC LIMIT ?').bind(vehicleId, limit);
  const { results } = await stmt.all<FuelRecord>();
  return results;
}

export async function getFuelRecordsByDateRange(
  db: D1Database, startDate: string, endDate: string, vehicleId?: number
): Promise<FuelRecord[]> {
  const stmt = vehicleId === undefined
    ? db.prepare('SELECT * FROM fuel_records WHERE date >= ? AND date <= ? ORDER BY odometer ASC')
        .bind(startDate, endDate)
    : db.prepare('SELECT * FROM fuel_records WHERE date >= ? AND date <= ? AND vehicle_id = ? ORDER BY odometer ASC')
        .bind(startDate, endDate, vehicleId);
  const { results } = await stmt.all<FuelRecord>();
  return results;
}

// ── Vehicles (spec 001) ───────────────────────────────────────────────────────

export async function insertVehicle(db: D1Database, name: string, isDefault = false): Promise<number> {
  const res = await db.prepare('INSERT INTO vehicles (name, is_default) VALUES (?, ?)')
    .bind(name, isDefault ? 1 : 0).run();
  return res.meta.last_row_id as number;
}

export async function getVehicleByName(db: D1Database, name: string): Promise<Vehicle | null> {
  return db.prepare('SELECT * FROM vehicles WHERE name = ? AND is_active = 1 LIMIT 1')
    .bind(name).first<Vehicle>();
}

export async function listVehicles(db: D1Database): Promise<Vehicle[]> {
  const { results } = await db.prepare('SELECT * FROM vehicles WHERE is_active = 1 ORDER BY id ASC').all<Vehicle>();
  return results;
}

export async function getDefaultVehicle(db: D1Database): Promise<Vehicle | null> {
  return db.prepare('SELECT * FROM vehicles WHERE is_default = 1 AND is_active = 1 LIMIT 1').first<Vehicle>();
}

export async function countVehicles(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM vehicles WHERE is_active = 1').first<{ n: number }>();
  return row?.n ?? 0;
}

// 默认车不变量：同一时刻仅一辆 is_default=1。清零 + 置位放在一个 batch 内保证原子。
export async function setDefaultVehicle(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare('UPDATE vehicles SET is_default = 0'),
    db.prepare('UPDATE vehicles SET is_default = 1 WHERE id = ?').bind(id),
  ]);
}
