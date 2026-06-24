import { FuelRecord, Vehicle, MaintenanceRecord, ReminderWithVehicle } from './types';

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
// 所有读路径都过滤 deleted_at IS NULL（软删除，spec 004）。
export async function getLastFuelRecord(db: D1Database, vehicleId?: number): Promise<FuelRecord | null> {
  if (vehicleId === undefined) {
    return db.prepare('SELECT * FROM fuel_records WHERE deleted_at IS NULL ORDER BY odometer DESC LIMIT 1').first<FuelRecord>();
  }
  return db.prepare('SELECT * FROM fuel_records WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY odometer DESC LIMIT 1')
    .bind(vehicleId).first<FuelRecord>();
}

export async function getRecentFuelRecords(db: D1Database, limit: number, vehicleId?: number): Promise<FuelRecord[]> {
  const stmt = vehicleId === undefined
    ? db.prepare('SELECT * FROM fuel_records WHERE deleted_at IS NULL ORDER BY odometer DESC LIMIT ?').bind(limit)
    : db.prepare('SELECT * FROM fuel_records WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY odometer DESC LIMIT ?').bind(vehicleId, limit);
  const { results } = await stmt.all<FuelRecord>();
  return results;
}

export async function getFuelRecordsByDateRange(
  db: D1Database, startDate: string, endDate: string, vehicleId?: number
): Promise<FuelRecord[]> {
  const stmt = vehicleId === undefined
    ? db.prepare('SELECT * FROM fuel_records WHERE date >= ? AND date <= ? AND deleted_at IS NULL ORDER BY odometer ASC')
        .bind(startDate, endDate)
    : db.prepare('SELECT * FROM fuel_records WHERE date >= ? AND date <= ? AND vehicle_id = ? AND deleted_at IS NULL ORDER BY odometer ASC')
        .bind(startDate, endDate, vehicleId);
  const { results } = await stmt.all<FuelRecord>();
  return results;
}

// 更新最近记录用：列白名单 + 参数化，只改提供的字段。
const FUEL_EDITABLE_COLUMNS = ['date', 'odometer', 'liters', 'price_total', 'fuel_type', 'note'] as const;

export async function updateFuelRecord(
  db: D1Database, id: number, fields: Record<string, unknown>
): Promise<number> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const col of FUEL_EDITABLE_COLUMNS) {
    if (fields[col] !== undefined) { sets.push(`${col} = ?`); binds.push(fields[col]); }
  }
  if (sets.length === 0) return 0;
  binds.push(id);
  const res = await db.prepare(`UPDATE fuel_records SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return res.meta.changes ?? 0;
}

export async function softDeleteFuelRecord(db: D1Database, id: number, deletedAt: string): Promise<void> {
  await db.prepare('UPDATE fuel_records SET deleted_at = ? WHERE id = ?').bind(deletedAt, id).run();
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

export async function renameVehicle(db: D1Database, id: number, newName: string): Promise<void> {
  await db.prepare('UPDATE vehicles SET name = ? WHERE id = ?').bind(newName, id).run();
}

// 默认车不变量：同一时刻仅一辆 is_default=1。清零 + 置位放在一个 batch 内保证原子。
export async function setDefaultVehicle(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare('UPDATE vehicles SET is_default = 0'),
    db.prepare('UPDATE vehicles SET is_default = 1 WHERE id = ?').bind(id),
  ]);
}

// ── Maintenance records (spec 002) ────────────────────────────────────────────

export async function insertMaintenanceRecord(db: D1Database, data: {
  date: string; type: string; odometer?: number | null;
  cost?: number | null; note?: string; vehicle_id?: number | null;
}): Promise<void> {
  await db.prepare(
    'INSERT INTO maintenance_records (date, type, odometer, cost, note, vehicle_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    data.date, data.type, data.odometer ?? null,
    data.cost ?? null, data.note ?? null, data.vehicle_id ?? null
  ).run();
}

// 按车（可选）+ 类型（可选，相等优先）过滤，按 date DESC, id DESC 倒序。
export async function getMaintenanceRecords(db: D1Database, opts: {
  vehicleId?: number; type?: string; limit?: number;
} = {}): Promise<MaintenanceRecord[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.vehicleId !== undefined) { where.push('vehicle_id = ?'); binds.push(opts.vehicleId); }
  if (opts.type !== undefined)      { where.push('type = ?');       binds.push(opts.type); }

  let sql = 'SELECT * FROM maintenance_records';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY date DESC, id DESC';
  if (opts.limit !== undefined) { sql += ' LIMIT ?'; binds.push(opts.limit); }

  const { results } = await db.prepare(sql).bind(...binds).all<MaintenanceRecord>();
  return results;
}

export async function getLastMaintenanceByType(
  db: D1Database, type: string, vehicleId?: number
): Promise<MaintenanceRecord | null> {
  const records = await getMaintenanceRecords(db, { vehicleId, type, limit: 1 });
  return records[0] ?? null;
}

// 跨 fuel + mileage 记录取该车（或全部）最新里程，供里程提醒判定。
// fuel 子查询排除软删除记录（spec 004），避免误删的高里程仍触发提醒。
export async function getLatestOdometer(db: D1Database, vehicleId?: number): Promise<number | null> {
  const row = vehicleId === undefined
    ? await db.prepare(
        'SELECT MAX(o) AS m FROM (SELECT odometer o FROM fuel_records WHERE deleted_at IS NULL UNION ALL SELECT odometer o FROM mileage_records)'
      ).first<{ m: number | null }>()
    : await db.prepare(
        'SELECT MAX(o) AS m FROM (SELECT odometer o FROM fuel_records WHERE vehicle_id = ?1 AND deleted_at IS NULL UNION ALL SELECT odometer o FROM mileage_records WHERE vehicle_id = ?1)'
      ).bind(vehicleId).first<{ m: number | null }>();
  return row?.m ?? null;
}

// ── Reminders (spec 003) ──────────────────────────────────────────────────────

export async function insertReminder(db: D1Database, data: {
  vehicle_id?: number | null; type: string; mode: 'mileage' | 'date';
  trigger_odometer?: number | null; trigger_date?: string | null;
  interval_km?: number | null; note?: string | null; chat_id?: string | null;
}): Promise<number> {
  const res = await db.prepare(
    'INSERT INTO reminders (vehicle_id, type, mode, trigger_odometer, trigger_date, interval_km, note, chat_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    data.vehicle_id ?? null, data.type, data.mode,
    data.trigger_odometer ?? null, data.trigger_date ?? null,
    data.interval_km ?? null, data.note ?? null, data.chat_id ?? null
  ).run();
  return res.meta.last_row_id as number;
}

export async function getActiveReminders(db: D1Database): Promise<ReminderWithVehicle[]> {
  const { results } = await db.prepare(
    `SELECT r.*, v.name AS vehicle_name
       FROM reminders r LEFT JOIN vehicles v ON r.vehicle_id = v.id
      WHERE r.status = 'active'
      ORDER BY r.id ASC`
  ).all<ReminderWithVehicle>();
  return results;
}

export async function listRemindersByVehicle(db: D1Database, vehicleId?: number): Promise<ReminderWithVehicle[]> {
  const all = await getActiveReminders(db);
  return vehicleId === undefined ? all : all.filter(r => r.vehicle_id === vehicleId);
}

// 取消匹配的活跃提醒（按类型 + 可选车辆），返回受影响条数。
export async function cancelReminders(db: D1Database, opts: { type: string; vehicleId?: number }): Promise<number> {
  const stmt = opts.vehicleId === undefined
    ? db.prepare("UPDATE reminders SET status = 'done' WHERE status = 'active' AND type = ?").bind(opts.type)
    : db.prepare("UPDATE reminders SET status = 'done' WHERE status = 'active' AND type = ? AND vehicle_id = ?")
        .bind(opts.type, opts.vehicleId);
  const res = await stmt.run();
  return res.meta.changes ?? 0;
}

export async function markReminderDone(db: D1Database, id: number, firedAt: string): Promise<void> {
  await db.prepare("UPDATE reminders SET status = 'done', fired_at = ? WHERE id = ?").bind(firedAt, id).run();
}
