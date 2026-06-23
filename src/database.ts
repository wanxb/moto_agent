import { FuelRecord } from './types';

export async function insertFuelRecord(db: D1Database, data: {
  date: string; odometer: number; liters: number;
  price_total: number; fuel_type?: string; note?: string;
}): Promise<void> {
  await db.prepare(
    'INSERT INTO fuel_records (date, odometer, liters, price_total, fuel_type, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(data.date, data.odometer, data.liters, data.price_total, data.fuel_type ?? '95', data.note ?? null).run();
}

export async function insertMileageRecord(db: D1Database, data: {
  date: string; odometer: number; note?: string;
}): Promise<void> {
  await db.prepare(
    'INSERT INTO mileage_records (date, odometer, note) VALUES (?, ?, ?)'
  ).bind(data.date, data.odometer, data.note ?? null).run();
}

export async function getLastFuelRecord(db: D1Database): Promise<FuelRecord | null> {
  return db.prepare('SELECT * FROM fuel_records ORDER BY odometer DESC LIMIT 1').first<FuelRecord>();
}

export async function getRecentFuelRecords(db: D1Database, limit: number): Promise<FuelRecord[]> {
  const { results } = await db.prepare(
    'SELECT * FROM fuel_records ORDER BY odometer DESC LIMIT ?'
  ).bind(limit).all<FuelRecord>();
  return results;
}

export async function getFuelRecordsByDateRange(
  db: D1Database, startDate: string, endDate: string
): Promise<FuelRecord[]> {
  const { results } = await db.prepare(
    'SELECT * FROM fuel_records WHERE date >= ? AND date <= ? ORDER BY odometer ASC'
  ).bind(startDate, endDate).all<FuelRecord>();
  return results;
}
