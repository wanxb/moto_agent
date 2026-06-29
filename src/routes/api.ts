// Dashboard REST API（ADR-0009） — 只读，token 鉴权，分页支持。
// 数据来源：现有 database.ts 函数，加少量直查 SQL。

import { getFuelRecordsByDateRange, getMaintenanceRecords } from '../database';
import { getActiveReminders, getUserById, getUserByTelegramId, updateUserLang } from '../database';
import { resolveSessionFromRequest } from '../services/session';
import type { FuelRecord, MaintenanceRecord } from '../types';

// ── Token 鉴权 ───────────────────────────────────────────────────────────────

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function tokenAuth(request: Request, env: { ALLOWED_CHAT_ID?: string }): Response | null {
  const expected = env.ALLOWED_CHAT_ID;
  if (!expected) return null;
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (token !== expected) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS_HEADERS });
  return null;
}

// ── 入口 ──────────────────────────────────────────────────────────────────────

export async function handleApiRequest(request: Request, env: { DB: D1Database; ALLOWED_CHAT_ID?: string; SESSION_KV: KVNamespace }): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } });
  }

  const url = new URL(request.url);
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: CORS_HEADERS });

  // /api/v1/me：当前登录用户（session cookie 鉴权，不走 ?token=）。GET 读、POST 改语言。
  if (url.pathname === '/api/v1/me') {
    const session = await resolveSessionFromRequest(request, env.SESSION_KV);
    if (!session) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS_HEADERS });

    if (request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { lang?: string };
      if (body.lang !== 'zh' && body.lang !== 'en') return new Response(JSON.stringify({ error: 'invalid_lang' }), { status: 400, headers: CORS_HEADERS });
      await updateUserLang(env.DB, session.user_id, body.lang);
      return json({ ok: true });
    }

    const user = await getUserById(env.DB, session.user_id);
    if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: CORS_HEADERS });
    return json({ user: { id: user.id, email: user.email, telegram_id: user.telegram_id, nickname: user.nickname, lang: user.lang, is_admin: user.is_admin } });
  }

  // 鉴权：优先 session cookie（多用户，按 user_id 过滤）；回退 ?token=（管理员，30 天过渡）。
  const auth = await resolveApiUser(request, env);
  if (auth instanceof Response) return auth;
  const userId = auth.userId;

  switch (url.pathname) {
    case '/api/v1/stats':        return json(await fuelStats(env.DB, url, userId));
    case '/api/v1/vehicles':     return json(await vehicleList(env.DB, userId));
    case '/api/v1/reminders':    return json(await reminderList(env.DB, url, userId));
    case '/api/v1/fuel-records': return json(await fuelRecordList(env.DB, url, userId));
    case '/api/v1/maintenance':  return json(await maintenanceList(env.DB, url, userId));
    default:                     return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: CORS_HEADERS });
  }
}

// 解析 API 调用者 → 有效 user_id（数据过滤用）。
//  session cookie 有效 → 该用户；否则 ?token= 命中 ALLOWED_CHAT_ID → 管理员（其 user_id；
//  未迁移则 undefined = 不过滤看全部，旧单用户 30 天过渡）；否则 401。
async function resolveApiUser(
  request: Request, env: { DB: D1Database; ALLOWED_CHAT_ID?: string; SESSION_KV: KVNamespace }
): Promise<{ userId?: number } | Response> {
  const session = await resolveSessionFromRequest(request, env.SESSION_KV);
  if (session) return { userId: session.user_id };

  const tokenErr = tokenAuth(request, env);
  if (tokenErr) return tokenErr;
  const admin = env.ALLOWED_CHAT_ID ? await getUserByTelegramId(env.DB, env.ALLOWED_CHAT_ID) : null;
  return { userId: admin?.id };
}

// ── 分页参数解析 ──────────────────────────────────────────────────────────────

function parsePagination(url: URL): { page: number; limit: number } {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
  return { page, limit };
}

function paginate<T>(items: T[], page: number, limit: number): { items: T[]; total: number; page: number; totalPages: number } {
  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  return { items: items.slice(offset, offset + limit), total, page, totalPages };
}

// ── /api/v1/stats?days=90&vehicle=小拉 ───────────────────────────────────────

interface StatsPoint {
  date: string;
  odometer: number;
  liters: number;
  cost: number;
  consumption: number | null;
  distance: number | null;
}

async function fuelStats(db: D1Database, url: URL, userId?: number): Promise<{ records: StatsPoint[]; avg: number; totalKm: number; totalCost: number; totalLiters: number }> {
  const days = Math.max(1, Number(url.searchParams.get('days') ?? 30));
  const vehicle = url.searchParams.get('vehicle') || undefined;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const records = vehicle
    ? await getFuelRecordsByVehicleName(db, since, vehicle, userId)
    : (await getFuelRecordsByDateRange(db, since, '2099-12-31', undefined, userId)).sort((a, b) => a.odometer - b.odometer);

  const points: StatsPoint[] = [];
  let totalKm = 0, totalCost = 0, totalLiters = 0, consumptionLiters = 0;

  for (let i = 0; i < records.length; i++) {
    const cur = records[i];
    const prev = i > 0 ? records[i - 1] : null;
    const km = prev ? cur.odometer - prev.odometer : null;
    const consumption = (km && km > 0) ? Number((prev!.liters / km * 100).toFixed(2)) : null;
    points.push({ date: cur.date, odometer: cur.odometer, liters: cur.liters, cost: cur.price_total, consumption, distance: km });
    if (km && km > 0) { totalKm += km; consumptionLiters += prev!.liters; }
    totalCost += cur.price_total;
    totalLiters += cur.liters;
  }

  const avg = totalKm > 0 ? Number((consumptionLiters / totalKm * 100).toFixed(2)) : 0;
  const latestOdometer = records.length > 0 ? records[records.length - 1].odometer : 0;
  return { records: points, avg, totalKm: latestOdometer, totalCost, totalLiters };
}

async function getFuelRecordsByVehicleName(db: D1Database, since: string, vehicle: string, userId?: number): Promise<FuelRecord[]> {
  const extra = userId !== undefined ? ' AND f.user_id = ?' : '';
  const binds = userId !== undefined ? [since, vehicle, vehicle, userId] : [since, vehicle, vehicle];
  const { results } = await db.prepare(
    `SELECT f.* FROM fuel_records f
       JOIN vehicles v ON f.vehicle_id = v.id
      WHERE f.date >= ? AND f.deleted_at IS NULL AND (v.name = ? OR v.alias = ?)${extra}
      ORDER BY f.odometer ASC`
  ).bind(...binds).all<FuelRecord>();
  return results;
}

// 同上但按日期倒序，fuel-records 列表用
async function getFuelRecordsByVehicleNameDesc(db: D1Database, since: string, vehicle: string, userId?: number): Promise<FuelRecord[]> {
  const extra = userId !== undefined ? ' AND f.user_id = ?' : '';
  const binds = userId !== undefined ? [since, vehicle, vehicle, userId] : [since, vehicle, vehicle];
  const { results } = await db.prepare(
    `SELECT f.* FROM fuel_records f
       JOIN vehicles v ON f.vehicle_id = v.id
      WHERE f.date >= ? AND f.deleted_at IS NULL AND (v.name = ? OR v.alias = ?)${extra}
      ORDER BY f.date DESC, f.odometer DESC`
  ).bind(...binds).all<FuelRecord>();
  return results;
}

// ── /api/v1/vehicles ─────────────────────────────────────────────────────────

interface VehicleInfo {
  name: string;
  alias: string | null;
  brand: string | null;
  model: string | null;
  fuel_type: string | null;
  tank_capacity: number | null;
  color: string | null;
  latestOdometer: number | null;
  lastFuelDate: string | null;
}

async function vehicleList(db: D1Database, userId?: number): Promise<{ vehicles: VehicleInfo[] }> {
  const extra = userId !== undefined ? ' AND v.user_id = ?' : '';
  const binds = userId !== undefined ? [userId] : [];
  const { results } = await db.prepare(
    `SELECT v.name, v.alias, v.brand, v.model, v.fuel_type, v.tank_capacity, v.color,
            (SELECT odometer FROM fuel_records WHERE vehicle_id = v.id AND deleted_at IS NULL ORDER BY odometer DESC LIMIT 1) AS latestOdometer,
            (SELECT date     FROM fuel_records WHERE vehicle_id = v.id AND deleted_at IS NULL ORDER BY odometer DESC LIMIT 1) AS lastFuelDate
       FROM vehicles v WHERE v.is_active = 1${extra} ORDER BY v.id ASC`
  ).bind(...binds).all<VehicleInfo>();
  return { vehicles: results };
}

// ── /api/v1/reminders?vehicle=小拉&page=1&limit=20 ───────────────────────────

interface ReminderInfo {
  type: string;
  mode: 'mileage' | 'date';
  trigger: string;
  vehicle: string | null;
}

async function reminderList(db: D1Database, url: URL, userId?: number): Promise<{ reminders: ReminderInfo[]; total: number; page: number; totalPages: number }> {
  const vehicle = url.searchParams.get('vehicle') || undefined;
  const { page, limit } = parsePagination(url);
  const reminders = await getActiveReminders(db, userId);
  const filtered = vehicle
    ? reminders.filter(r => r.vehicle_name === vehicle)
    : reminders;

  const mapped = filtered.map(r => ({
    type: r.type,
    mode: r.mode as 'mileage' | 'date',
    trigger: r.mode === 'mileage' ? `${(r.trigger_odometer ?? 0).toLocaleString('zh')} km` : (r.trigger_date ?? ''),
    vehicle: r.vehicle_name,
  }));

  const p = paginate(mapped, page, limit);
  return { reminders: p.items, total: p.total, page: p.page, totalPages: p.totalPages };
}

// ── /api/v1/fuel-records?vehicle=小拉&days=90&page=1&limit=20 ───────────────

interface FuelRecordItem {
  date: string;
  odometer: number;
  liters: number;
  cost: number;
  fuel_type: string;
  consumption: number | null;
  distance: number | null;
}

async function fuelRecordList(db: D1Database, url: URL, userId?: number): Promise<{ records: FuelRecordItem[]; total: number; page: number; totalPages: number }> {
  const days = Math.max(1, Number(url.searchParams.get('days') ?? 30));
  const vehicle = url.searchParams.get('vehicle') || undefined;
  const { page, limit } = parsePagination(url);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  // 直接按日期倒序取记录（列表不需要 fill-to-fill 油耗计算）
  const records = vehicle
    ? await getFuelRecordsByVehicleNameDesc(db, since, vehicle, userId)
    : (await getFuelRecordsByDateRange(db, since, '2099-12-31', undefined, userId)).sort((a, b) => b.date.localeCompare(a.date) || b.odometer - a.odometer);

  const items: FuelRecordItem[] = records.map(r => ({
    date: r.date,
    odometer: r.odometer,
    liters: r.liters,
    cost: r.price_total,
    fuel_type: r.fuel_type,
    consumption: null,
    distance: null,
  }));

  const p = paginate(items, page, limit);
  return { records: p.items, total: p.total, page: p.page, totalPages: p.totalPages };
}

// ── /api/v1/maintenance?vehicle=小拉&page=1&limit=10 ─────────────────────────

interface MaintenanceRecordItem {
  date: string;
  type: string;
  odometer: number | null;
  cost: number | null;
  note: string | null;
}

async function maintenanceList(db: D1Database, url: URL, userId?: number): Promise<{ records: MaintenanceRecordItem[]; total: number; page: number; totalPages: number }> {
  const vehicle = url.searchParams.get('vehicle') || undefined;
  const { page, limit } = parsePagination(url);

  let records: MaintenanceRecord[];
  if (vehicle) {
    records = await getMaintenanceRecordsByVehicleName(db, vehicle, userId);
  } else {
    records = await getMaintenanceRecords(db, { userId });
  }

  const mapped = records.map(r => ({
    date: r.date,
    type: r.type,
    odometer: r.odometer,
    cost: r.cost,
    note: r.note,
  }));

  const p = paginate(mapped, page, limit);
  return { records: p.items, total: p.total, page: p.page, totalPages: p.totalPages };
}

async function getMaintenanceRecordsByVehicleName(db: D1Database, vehicle: string, userId?: number): Promise<MaintenanceRecord[]> {
  const extra = userId !== undefined ? ' AND m.user_id = ?' : '';
  const binds = userId !== undefined ? [vehicle, vehicle, userId] : [vehicle, vehicle];
  const { results } = await db.prepare(
    `SELECT m.* FROM maintenance_records m
       JOIN vehicles v ON m.vehicle_id = v.id
      WHERE v.is_active = 1 AND m.deleted_at IS NULL AND (v.name = ? OR v.alias = ?)${extra}
      ORDER BY m.date DESC, m.id DESC`
  ).bind(...binds).all<MaintenanceRecord>();
  return results;
}
