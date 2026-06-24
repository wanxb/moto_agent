// Dashboard REST API（ADR-0009） — 只读，token 鉴权。
// 数据来源：现有 database.ts 函数，加少量直查 SQL。

import { getRecentFuelRecords, getFuelRecordsByDateRange } from '../database';
import { getActiveReminders } from '../database';
import type { FuelRecord } from '../types';

// ── Token 鉴权 ───────────────────────────────────────────────────────────────

const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

function tokenAuth(request: Request, env: { ALLOWED_CHAT_ID?: string }): Response | null {
  const expected = env.ALLOWED_CHAT_ID;
  if (!expected) return null;  // 未设 ALLOWED_CHAT_ID → Dashboard 开放（单用户阶段安全等效）
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (token !== expected) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS_HEADERS });
  return null;
}

// ── 入口 ──────────────────────────────────────────────────────────────────────

export async function handleApiRequest(request: Request, env: { DB: D1Database; ALLOWED_CHAT_ID?: string }): Promise<Response> {
  // CORS preflight（浏览器跨域 fetch 先发 OPTIONS）
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } });
  }

  const authErr = tokenAuth(request, env);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: CORS_HEADERS });

  switch (url.pathname) {
    case '/api/v1/stats':     return json(await fuelStats(env.DB, url));
    case '/api/v1/vehicles':  return json(await vehicleList(env.DB));
    case '/api/v1/reminders': return json(await reminderList(env.DB));
    default:                  return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: CORS_HEADERS });
  }
}

// ── /api/v1/stats?days=90&vehicle=小拉 ───────────────────────────────────────

interface StatsPoint {
  date: string;
  odometer: number;
  liters: number;
  cost: number;
  consumption: number | null;   // L/100km, null for first record
  distance: number | null;
}

async function fuelStats(db: D1Database, url: URL): Promise<{ records: StatsPoint[]; avg: number; totalKm: number; totalCost: number; totalLiters: number }> {
  const days = Math.max(1, Number(url.searchParams.get('days') ?? 90));
  const vehicle = url.searchParams.get('vehicle') || undefined;
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  // 取指定车（或全部）的日期范围记录
  const records = vehicle
    ? await getFuelRecordsByVehicleName(db, since, vehicle)
    : (await getFuelRecordsByDateRange(db, since, '2099-12-31')).sort((a, b) => a.odometer - b.odometer);

  const points: StatsPoint[] = [];
  let totalKm = 0, totalCost = 0, totalLiters = 0;

  for (let i = 0; i < records.length; i++) {
    const cur = records[i];
    const prev = i > 0 ? records[i - 1] : null;
    const km = prev ? cur.odometer - prev.odometer : null;
    const consumption = (km && km > 0) ? Number((prev!.liters / km * 100).toFixed(2)) : null;
    points.push({ date: cur.date, odometer: cur.odometer, liters: cur.liters, cost: cur.price_total, consumption, distance: km });
    if (km && km > 0) { totalKm += km; totalCost += cur.price_total; totalLiters += prev!.liters; }
  }

  const avg = totalKm > 0 ? Number((totalLiters / totalKm * 100).toFixed(2)) : 0;
  return { records: points, avg, totalKm, totalCost, totalLiters };
}

// 按车辆名（而非 id）取日期范围记录，Dashboard 用
async function getFuelRecordsByVehicleName(db: D1Database, since: string, vehicle: string): Promise<FuelRecord[]> {
  const { results } = await db.prepare(
    `SELECT f.* FROM fuel_records f
       JOIN vehicles v ON f.vehicle_id = v.id
      WHERE f.date >= ? AND f.deleted_at IS NULL AND (v.name = ? OR v.alias = ?)
      ORDER BY f.odometer ASC`
  ).bind(since, vehicle, vehicle).all<FuelRecord>();
  return results;
}

// ── /api/v1/vehicles ─────────────────────────────────────────────────────────

interface VehicleInfo {
  name: string;
  alias: string | null;
  latestOdometer: number | null;
  lastFuelDate: string | null;
}

async function vehicleList(db: D1Database): Promise<{ vehicles: VehicleInfo[] }> {
  const { results } = await db.prepare(
    `SELECT v.name, v.alias,
            (SELECT odometer FROM fuel_records WHERE vehicle_id = v.id AND deleted_at IS NULL ORDER BY odometer DESC LIMIT 1) AS latestOdometer,
            (SELECT date     FROM fuel_records WHERE vehicle_id = v.id AND deleted_at IS NULL ORDER BY odometer DESC LIMIT 1) AS lastFuelDate
       FROM vehicles v WHERE v.is_active = 1 ORDER BY v.id ASC`
  ).all<VehicleInfo>();
  return { vehicles: results };
}

// ── /api/v1/reminders ────────────────────────────────────────────────────────

interface ReminderInfo {
  type: string;
  mode: 'mileage' | 'date';
  trigger: string;          // "13,000 km" or "2027-01-05"
  vehicle: string | null;
}

async function reminderList(db: D1Database): Promise<{ reminders: ReminderInfo[] }> {
  const reminders = await getActiveReminders(db);
  return {
    reminders: reminders.map(r => ({
      type: r.type,
      mode: r.mode as 'mileage' | 'date',
      trigger: r.mode === 'mileage' ? `${(r.trigger_odometer ?? 0).toLocaleString('zh')} km` : (r.trigger_date ?? ''),
      vehicle: r.vehicle_name,
    })),
  };
}
