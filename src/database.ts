import { FuelRecord, Vehicle, MaintenanceRecord, ReminderWithVehicle, User } from './types';
import { FUEL_EDITABLE_COLUMNS } from './config';

// ── Users (spec 016 多用户) ────────────────────────────────────────────────────
// 隔离约定：记录/车辆/提醒读路径都接受可选 userId，提供时按 user_id 过滤（idiom 同 vehicleId）。
// 多用户调用方由中间件/dispatchTool 解析出 userId 后显式传入；单用户/历史路径不传即不过滤。

export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').bind(id).first<User>();
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').bind(email).first<User>();
}

export async function getUserByTelegramId(db: D1Database, telegramId: string): Promise<User | null> {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ? LIMIT 1').bind(telegramId).first<User>();
}

// 创建用户。email / telegramId 至少给一个；返回新用户 id。
export async function createUser(db: D1Database, opts: {
  email?: string | null; telegramId?: string | null;
  nickname?: string | null; lang?: 'zh' | 'en'; isAdmin?: boolean;
}): Promise<number> {
  const res = await db.prepare(
    `INSERT INTO users (email, telegram_id, nickname, lang, is_admin)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    opts.email ?? null, opts.telegramId ?? null,
    opts.nickname ?? null, opts.lang ?? 'zh', opts.isAdmin ? 1 : 0
  ).run();
  return res.meta.last_row_id as number;
}

export async function updateUserLastLogin(db: D1Database, id: number, when: string): Promise<void> {
  await db.prepare('UPDATE users SET last_login = ? WHERE id = ?').bind(when, id).run();
}

// 开放自助（spec 016 修订：去掉白名单门控）：TG 用户首次发消息即自动建号，返回其 user_id。
// email 留空（邮箱是另一条注册入口）；之后可经 /bind 合并到邮箱账号。
export async function getOrCreateTelegramUser(
  db: D1Database, telegramId: string, lang: 'zh' | 'en' = 'zh'
): Promise<number> {
  const existing = await getUserByTelegramId(db, telegramId);
  if (existing) return existing.id;
  try {
    return await createUser(db, { telegramId, lang });
  } catch {
    // 并发首消息可能同时 INSERT 撞 UNIQUE(telegram_id)，回查取胜出的那行
    const u = await getUserByTelegramId(db, telegramId);
    if (u) return u.id;
    throw new Error('getOrCreateTelegramUser: 建号失败');
  }
}

// 绑定 Telegram 到邮箱账号（spec 016 §3.2）。调用方应已校验绑定码。
//   情形 A：该 telegram_id 尚无独立账号 → 直接挂到邮箱账号。
//   情形 B（账号合并）：telegram_id 已有独立账号 → 其名下数据迁到邮箱账号、旧号置 'merged' 失活。
// 合并在一个 D1 batch 内原子完成（任一步失败整体回滚）。返回是否发生了合并。
export async function bindTelegramToUser(
  db: D1Database, email: string, telegramId: string
): Promise<{ merged: boolean }> {
  const target = await getUserByEmail(db, email);
  if (!target) throw new Error('bindTelegramToUser: email 账号不存在');
  // 目标邮箱已绑到别的 Telegram → 拒绝
  if (target.telegram_id && target.telegram_id !== telegramId) {
    throw new Error('bindTelegramToUser: 该邮箱已绑定其他 Telegram');
  }

  const existing = await getUserByTelegramId(db, telegramId);
  if (existing && existing.id === target.id) return { merged: false };  // 幂等

  if (!existing) {
    // 情形 A：直接挂载
    await db.prepare('UPDATE users SET telegram_id = ? WHERE id = ?').bind(telegramId, target.id).run();
    return { merged: false };
  }

  // 情形 B：把 existing(U_t) 名下数据迁到 target(E)，U_t 失活。
  // 先清 U_t.telegram_id 腾出 UNIQUE，再迁数据，最后把 telegram_id 挂到 E。
  await db.batch([
    db.prepare('UPDATE users SET telegram_id = NULL WHERE id = ?').bind(existing.id),
    db.prepare('UPDATE vehicles            SET user_id = ? WHERE user_id = ?').bind(target.id, existing.id),
    db.prepare('UPDATE fuel_records        SET user_id = ? WHERE user_id = ?').bind(target.id, existing.id),
    db.prepare('UPDATE mileage_records     SET user_id = ? WHERE user_id = ?').bind(target.id, existing.id),
    db.prepare('UPDATE maintenance_records SET user_id = ? WHERE user_id = ?').bind(target.id, existing.id),
    db.prepare('UPDATE reminders           SET user_id = ? WHERE user_id = ?').bind(target.id, existing.id),
    db.prepare("UPDATE users SET status = 'merged' WHERE id = ?").bind(existing.id),
    db.prepare('UPDATE users SET telegram_id = ? WHERE id = ?').bind(telegramId, target.id),
  ]);
  return { merged: true };
}

// ── Fuel / mileage records ────────────────────────────────────────────────────

export async function insertFuelRecord(db: D1Database, data: {
  date: string; odometer: number; liters: number;
  price_total: number; fuel_type?: string; note?: string;
  vehicle_id?: number | null; user_id?: number | null;
}): Promise<void> {
  await db.prepare(
    'INSERT INTO fuel_records (date, odometer, liters, price_total, fuel_type, note, vehicle_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    data.date, data.odometer, data.liters, data.price_total,
    data.fuel_type ?? '95', data.note ?? null, data.vehicle_id ?? null, data.user_id ?? null
  ).run();
}

export async function insertMileageRecord(db: D1Database, data: {
  date: string; odometer: number; note?: string; vehicle_id?: number | null; user_id?: number | null;
}): Promise<void> {
  await db.prepare(
    'INSERT INTO mileage_records (date, odometer, note, vehicle_id, user_id) VALUES (?, ?, ?, ?, ?)'
  ).bind(data.date, data.odometer, data.note ?? null, data.vehicle_id ?? null, data.user_id ?? null).run();
}

// vehicleId / userId 省略 → 该维度不过滤（兼容单用户/历史数据）；提供 → 仅匹配。
// 所有读路径都过滤 deleted_at IS NULL（软删除，spec 004）。
export async function getLastFuelRecord(db: D1Database, vehicleId?: number, userId?: number): Promise<FuelRecord | null> {
  const where: string[] = ['deleted_at IS NULL'];
  const binds: unknown[] = [];
  if (vehicleId !== undefined) { where.push('vehicle_id = ?'); binds.push(vehicleId); }
  if (userId !== undefined)    { where.push('user_id = ?');    binds.push(userId); }
  const sql = 'SELECT * FROM fuel_records WHERE ' + where.join(' AND ') + ' ORDER BY date DESC, id DESC LIMIT 1';
  return db.prepare(sql).bind(...binds).first<FuelRecord>();
}

export async function getRecentFuelRecords(db: D1Database, limit: number, vehicleId?: number, userId?: number): Promise<FuelRecord[]> {
  const where: string[] = ['deleted_at IS NULL'];
  const binds: unknown[] = [];
  if (vehicleId !== undefined) { where.push('vehicle_id = ?'); binds.push(vehicleId); }
  if (userId !== undefined)    { where.push('user_id = ?');    binds.push(userId); }
  binds.push(limit);
  const sql = 'SELECT * FROM fuel_records WHERE ' + where.join(' AND ') + ' ORDER BY date DESC, id DESC LIMIT ?';
  const { results } = await db.prepare(sql).bind(...binds).all<FuelRecord>();
  return results;
}

export async function getFuelRecordsByDateRange(
  db: D1Database, startDate: string, endDate: string, vehicleId?: number, userId?: number
): Promise<FuelRecord[]> {
  const where: string[] = ['date >= ?', 'date <= ?', 'deleted_at IS NULL'];
  const binds: unknown[] = [startDate, endDate];
  if (vehicleId !== undefined) { where.push('vehicle_id = ?'); binds.push(vehicleId); }
  if (userId !== undefined)    { where.push('user_id = ?');    binds.push(userId); }
  const sql = 'SELECT * FROM fuel_records WHERE ' + where.join(' AND ') + ' ORDER BY odometer ASC';
  const { results } = await db.prepare(sql).bind(...binds).all<FuelRecord>();
  return results;
}

// 更新最近记录用：列白名单 + 参数化，只改提供的字段。白名单来自 config.ts。

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

// 定位活跃加油记录（任意记录删除用）：按车 + 用户 + 日期 + 里程任意组合过滤，按 date ASC, id ASC 正序。
// 至少要给 date 或 odometer 之一，否则返回空数组（避免误把全部记录当候选）。
export async function findFuelRecords(db: D1Database, opts: {
  vehicleId?: number; date?: string; odometer?: number; userId?: number;
}): Promise<FuelRecord[]> {
  if (opts.date === undefined && opts.odometer === undefined) return [];
  const where: string[] = ['deleted_at IS NULL'];
  const binds: unknown[] = [];
  if (opts.vehicleId !== undefined) { where.push('vehicle_id = ?'); binds.push(opts.vehicleId); }
  if (opts.userId !== undefined)    { where.push('user_id = ?');    binds.push(opts.userId); }
  if (opts.date !== undefined)      { where.push('date = ?');       binds.push(opts.date); }
  if (opts.odometer !== undefined)  { where.push('odometer = ?');   binds.push(opts.odometer); }

  const sql = 'SELECT * FROM fuel_records WHERE ' + where.join(' AND ') + ' ORDER BY date ASC, id ASC';
  const { results } = await db.prepare(sql).bind(...binds).all<FuelRecord>();
  return results;
}

// ── Vehicles (spec 001) ───────────────────────────────────────────────────────

export async function insertVehicle(db: D1Database, name: string, opts?: {
  isDefault?: boolean; brand?: string; model?: string;
  fuel_type?: string; tank_capacity?: number; color?: string; userId?: number | null;
}): Promise<number> {
  const res = await db.prepare(
    `INSERT INTO vehicles (name, is_default, brand, model, fuel_type, tank_capacity, color, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    name, opts?.isDefault ? 1 : 0,
    opts?.brand ?? null, opts?.model ?? null,
    opts?.fuel_type ?? null, opts?.tank_capacity ?? null, opts?.color ?? null,
    opts?.userId ?? null
  ).run();
  return res.meta.last_row_id as number;
}

export async function getVehicleByName(db: D1Database, name: string, userId?: number): Promise<Vehicle | null> {
  const where: string[] = ['name = ?', 'is_active = 1'];
  const binds: unknown[] = [name];
  if (userId !== undefined) { where.push('user_id = ?'); binds.push(userId); }
  return db.prepare('SELECT * FROM vehicles WHERE ' + where.join(' AND ') + ' LIMIT 1').bind(...binds).first<Vehicle>();
}

export async function listVehicles(db: D1Database, userId?: number): Promise<Vehicle[]> {
  const where: string[] = ['is_active = 1'];
  const binds: unknown[] = [];
  if (userId !== undefined) { where.push('user_id = ?'); binds.push(userId); }
  const sql = 'SELECT * FROM vehicles WHERE ' + where.join(' AND ') + ' ORDER BY id ASC';
  const { results } = await db.prepare(sql).bind(...binds).all<Vehicle>();
  return results;
}

export async function getDefaultVehicle(db: D1Database, userId?: number): Promise<Vehicle | null> {
  const where: string[] = ['is_default = 1', 'is_active = 1'];
  const binds: unknown[] = [];
  if (userId !== undefined) { where.push('user_id = ?'); binds.push(userId); }
  return db.prepare('SELECT * FROM vehicles WHERE ' + where.join(' AND ') + ' LIMIT 1').bind(...binds).first<Vehicle>();
}

export async function countVehicles(db: D1Database, userId?: number): Promise<number> {
  const where: string[] = ['is_active = 1'];
  const binds: unknown[] = [];
  if (userId !== undefined) { where.push('user_id = ?'); binds.push(userId); }
  const row = await db.prepare('SELECT COUNT(*) AS n FROM vehicles WHERE ' + where.join(' AND ')).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function renameVehicle(db: D1Database, id: number, newName: string): Promise<void> {
  await db.prepare('UPDATE vehicles SET name = ? WHERE id = ?').bind(newName, id).run();
}

// 按全名或别名匹配（spec 009）。用于 resolveVehicle 等用户侧指代。
export async function getVehicleByNameOrAlias(db: D1Database, nameOrAlias: string, userId?: number): Promise<Vehicle | null> {
  const where: string[] = ['(name = ? OR alias = ?)', 'is_active = 1'];
  const binds: unknown[] = [nameOrAlias, nameOrAlias];
  if (userId !== undefined) { where.push('user_id = ?'); binds.push(userId); }
  return db.prepare('SELECT * FROM vehicles WHERE ' + where.join(' AND ') + ' LIMIT 1').bind(...binds).first<Vehicle>();
}

export async function setVehicleAlias(db: D1Database, id: number, alias: string | null): Promise<void> {
  await db.prepare('UPDATE vehicles SET alias = ? WHERE id = ?').bind(alias, id).run();
}

// 默认车不变量：同一时刻仅一辆 is_default=1。清零 + 置位放在一个 batch 内保证原子。
// userId 提供时只在该用户范围内重置，避免影响其他用户的默认车。
export async function setDefaultVehicle(db: D1Database, id: number, userId?: number): Promise<void> {
  const clear = userId === undefined
    ? db.prepare('UPDATE vehicles SET is_default = 0')
    : db.prepare('UPDATE vehicles SET is_default = 0 WHERE user_id = ?').bind(userId);
  await db.batch([
    clear,
    db.prepare('UPDATE vehicles SET is_default = 1 WHERE id = ?').bind(id),
  ]);
}

// 车辆属性白名单（spec 011）。空字符串 → null。
const VEHICLE_EDITABLE_COLUMNS = ['brand', 'model', 'fuel_type', 'tank_capacity', 'color'];

export async function updateVehicle(
  db: D1Database, id: number,
  fields: Partial<Pick<Vehicle, 'brand' | 'model' | 'fuel_type' | 'tank_capacity' | 'color'>>
): Promise<number> {
  const entries = Object.entries(fields).filter(
    ([k]) => VEHICLE_EDITABLE_COLUMNS.includes(k) && fields[k as keyof typeof fields] !== undefined
  );
  if (!entries.length) return 0;
  const setClauses = entries.map(([k]) => `${k} = ?`);
  const values = entries.map(([, v]) => (v === '' ? null : (v ?? null)));
  const sql = `UPDATE vehicles SET ${setClauses.join(', ')} WHERE id = ?`;
  const res = await db.prepare(sql).bind(...values, id).run();
  return res.meta.changes ?? 0;
}

/** 查询该车最近 5 条加油记录中出现最多的 fuel_type 及其次数。无记录时返回 null。 */
export async function getVehicleMostUsedFuelType(
  db: D1Database, vehicleId: number
): Promise<{ fuel_type: string; count: number } | null> {
  const { results } = await db.prepare(
    `SELECT fuel_type, COUNT(*) AS count FROM (
       SELECT fuel_type FROM fuel_records
        WHERE vehicle_id = ? AND deleted_at IS NULL
        ORDER BY date DESC, id DESC LIMIT 5
     ) GROUP BY fuel_type ORDER BY count DESC LIMIT 1`
  ).bind(vehicleId).all<{ fuel_type: string; count: number }>();
  return results[0] ?? null;
}

// ── Maintenance records (spec 002) ────────────────────────────────────────────

export async function insertMaintenanceRecord(db: D1Database, data: {
  date: string; type: string; odometer?: number | null;
  cost?: number | null; note?: string; vehicle_id?: number | null; user_id?: number | null;
}): Promise<void> {
  await db.prepare(
    'INSERT INTO maintenance_records (date, type, odometer, cost, note, vehicle_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    data.date, data.type, data.odometer ?? null,
    data.cost ?? null, data.note ?? null, data.vehicle_id ?? null, data.user_id ?? null
  ).run();
}

// 按车（可选）+ 用户（可选）+ 类型（可选，相等优先）过滤，按 date DESC, id DESC 倒序。
// 所有读路径都过滤 deleted_at IS NULL（软删除，spec 017）。
export async function getMaintenanceRecords(db: D1Database, opts: {
  vehicleId?: number; type?: string; limit?: number; userId?: number;
} = {}): Promise<MaintenanceRecord[]> {
  const where: string[] = ['deleted_at IS NULL'];
  const binds: unknown[] = [];
  if (opts.vehicleId !== undefined) { where.push('vehicle_id = ?'); binds.push(opts.vehicleId); }
  if (opts.userId !== undefined)    { where.push('user_id = ?');    binds.push(opts.userId); }
  if (opts.type !== undefined)      { where.push('type = ?');       binds.push(opts.type); }

  let sql = 'SELECT * FROM maintenance_records WHERE ' + where.join(' AND ');
  sql += ' ORDER BY date DESC, id DESC';
  if (opts.limit !== undefined) { sql += ' LIMIT ?'; binds.push(opts.limit); }

  const { results } = await db.prepare(sql).bind(...binds).all<MaintenanceRecord>();
  return results;
}

export async function getLastMaintenanceByType(
  db: D1Database, type: string, vehicleId?: number, userId?: number
): Promise<MaintenanceRecord | null> {
  const records = await getMaintenanceRecords(db, { vehicleId, type, limit: 1, userId });
  return records[0] ?? null;
}

// 定位活跃维保记录（删除/去重用）：按车 + 用户 + 类型 + 日期任意组合过滤，按 date ASC, id ASC 正序
// （最早在前，便于 keep_one 保留最早一条）。仅返回未软删除的。
export async function findMaintenanceRecords(db: D1Database, opts: {
  vehicleId?: number; type?: string; date?: string; userId?: number;
}): Promise<MaintenanceRecord[]> {
  const where: string[] = ['deleted_at IS NULL'];
  const binds: unknown[] = [];
  if (opts.vehicleId !== undefined) { where.push('vehicle_id = ?'); binds.push(opts.vehicleId); }
  if (opts.userId !== undefined)    { where.push('user_id = ?');    binds.push(opts.userId); }
  if (opts.type !== undefined)      { where.push('type = ?');       binds.push(opts.type); }
  if (opts.date !== undefined)      { where.push('date = ?');       binds.push(opts.date); }

  const sql = 'SELECT * FROM maintenance_records WHERE ' + where.join(' AND ') + ' ORDER BY date ASC, id ASC';
  const { results } = await db.prepare(sql).bind(...binds).all<MaintenanceRecord>();
  return results;
}

export async function softDeleteMaintenanceRecord(db: D1Database, id: number, deletedAt: string): Promise<void> {
  await db.prepare('UPDATE maintenance_records SET deleted_at = ? WHERE id = ?').bind(deletedAt, id).run();
}

// 跨 fuel + mileage 记录取该车（或全部）最新里程，供里程提醒判定。
// fuel 子查询排除软删除记录（spec 004），避免误删的高里程仍触发提醒。
// vehicleId / userId 提供时同时约束两段子查询。
export async function getLatestOdometer(db: D1Database, vehicleId?: number, userId?: number): Promise<number | null> {
  const fuelWhere: string[] = ['deleted_at IS NULL'];
  const mileWhere: string[] = [];
  const fuelBinds: unknown[] = [];
  const mileBinds: unknown[] = [];
  if (vehicleId !== undefined) {
    fuelWhere.push('vehicle_id = ?'); fuelBinds.push(vehicleId);
    mileWhere.push('vehicle_id = ?'); mileBinds.push(vehicleId);
  }
  if (userId !== undefined) {
    fuelWhere.push('user_id = ?'); fuelBinds.push(userId);
    mileWhere.push('user_id = ?'); mileBinds.push(userId);
  }
  const fuelSql = 'SELECT odometer o FROM fuel_records WHERE ' + fuelWhere.join(' AND ');
  const mileSql = 'SELECT odometer o FROM mileage_records' + (mileWhere.length ? ' WHERE ' + mileWhere.join(' AND ') : '');
  const sql = `SELECT MAX(o) AS m FROM (${fuelSql} UNION ALL ${mileSql})`;
  const row = await db.prepare(sql).bind(...fuelBinds, ...mileBinds).first<{ m: number | null }>();
  return row?.m ?? null;
}

// ── Reminders (spec 003) ──────────────────────────────────────────────────────

export async function insertReminder(db: D1Database, data: {
  vehicle_id?: number | null; type: string; mode: 'mileage' | 'date';
  trigger_odometer?: number | null; trigger_date?: string | null;
  interval_km?: number | null; note?: string | null; chat_id?: string | null;
  user_id?: number | null;
}): Promise<number> {
  const res = await db.prepare(
    'INSERT INTO reminders (vehicle_id, type, mode, trigger_odometer, trigger_date, interval_km, note, chat_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    data.vehicle_id ?? null, data.type, data.mode,
    data.trigger_odometer ?? null, data.trigger_date ?? null,
    data.interval_km ?? null, data.note ?? null, data.chat_id ?? null, data.user_id ?? null
  ).run();
  return res.meta.last_row_id as number;
}

// userId 省略 → 全部活跃提醒（cron 扫描用，跨用户）；提供 → 仅该用户（用户侧"我的提醒"）。
export async function getActiveReminders(db: D1Database, userId?: number): Promise<ReminderWithVehicle[]> {
  const where: string[] = ["r.status = 'active'"];
  const binds: unknown[] = [];
  if (userId !== undefined) { where.push('r.user_id = ?'); binds.push(userId); }
  const { results } = await db.prepare(
    `SELECT r.*, v.name AS vehicle_name
       FROM reminders r LEFT JOIN vehicles v ON r.vehicle_id = v.id
      WHERE ${where.join(' AND ')}
      ORDER BY r.id ASC`
  ).bind(...binds).all<ReminderWithVehicle>();
  return results;
}

export async function listRemindersByVehicle(db: D1Database, vehicleId?: number, userId?: number): Promise<ReminderWithVehicle[]> {
  const all = await getActiveReminders(db, userId);
  return vehicleId === undefined ? all : all.filter(r => r.vehicle_id === vehicleId);
}

// 取消匹配的活跃提醒（按类型 + 可选车辆 + 可选用户），返回受影响条数。
export async function cancelReminders(db: D1Database, opts: { type: string; vehicleId?: number; userId?: number }): Promise<number> {
  const where: string[] = ["status = 'active'", 'type = ?'];
  const binds: unknown[] = [opts.type];
  if (opts.vehicleId !== undefined) { where.push('vehicle_id = ?'); binds.push(opts.vehicleId); }
  if (opts.userId !== undefined)    { where.push('user_id = ?');    binds.push(opts.userId); }
  const res = await db.prepare(`UPDATE reminders SET status = 'done' WHERE ${where.join(' AND ')}`).bind(...binds).run();
  return res.meta.changes ?? 0;
}

export async function markReminderDone(db: D1Database, id: number, firedAt: string): Promise<void> {
  await db.prepare("UPDATE reminders SET status = 'done', fired_at = ? WHERE id = ?").bind(firedAt, id).run();
}

// ── 知识库 RAG（spec 015）───────────────────────────────────────────────────────

import type { KnowledgeChunk } from './types';

/** 按 id 列表查询 chunk 原文，保持传入顺序（即 Vectorize 的相关度排序） */
export async function getChunksById(db: D1Database, ids: number[]): Promise<KnowledgeChunk[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const sql = `SELECT * FROM knowledge_chunks WHERE id IN (${placeholders})`;
  const { results } = await db.prepare(sql).bind(...ids).all<KnowledgeChunk>();
  const map = new Map(results.map(r => [r.id, r]));
  return ids.map(id => map.get(id)).filter((r): r is KnowledgeChunk => r !== undefined);
}
