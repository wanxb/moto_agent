import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';

// Tests use SELF.fetch to make real HTTP requests through the Miniflare worker.

const TOKEN = '999999'; // = ALLOWED_CHAT_ID（Dashboard token 复用白名单）
function apiUrl(path: string) { return `http://localhost${path}&token=${TOKEN}`; }

beforeAll(async () => {
  // Ensure tables exist (the worker's fetch path would init them, but we'll ensure here)
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS vehicles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, alias TEXT, is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS fuel_records (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, odometer REAL NOT NULL, liters REAL NOT NULL, price_total REAL NOT NULL, fuel_type TEXT NOT NULL DEFAULT '95', note TEXT, vehicle_id INTEGER, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, type TEXT NOT NULL, mode TEXT NOT NULL, trigger_odometer REAL, trigger_date TEXT, interval_km REAL, note TEXT, chat_id TEXT, status TEXT NOT NULL DEFAULT 'active', fired_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM fuel_records').run();
  await env.DB.prepare('DELETE FROM vehicles').run();
  await env.DB.prepare('DELETE FROM reminders').run();
});

describe('/api/v1/vehicles', () => {
  it('returns empty list when no vehicles', async () => {
    const res = await SELF.fetch(apiUrl('/api/v1/vehicles?x=1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { vehicles: unknown[] };
    expect(body.vehicles).toEqual([]);
  });

  it('returns vehicles with latest odometer', async () => {
    await env.DB.prepare("INSERT INTO vehicles (name, is_default) VALUES ('小绿', 1)").run();
    await env.DB.prepare("INSERT INTO fuel_records (date, odometer, liters, price_total, vehicle_id) VALUES ('2026-06-01', 10000, 10, 98, 1)").run();
    await env.DB.prepare("INSERT INTO fuel_records (date, odometer, liters, price_total, vehicle_id) VALUES ('2026-06-10', 10200, 9, 88, 1)").run();

    const res = await SELF.fetch(apiUrl('/api/v1/vehicles?x=2'));
    expect(res.status).toBe(200);
    const body = await res.json() as { vehicles: { name: string; latestOdometer: number | null; lastFuelDate: string | null }[] };
    expect(body.vehicles).toHaveLength(1);
    expect(body.vehicles[0].name).toBe('小绿');
    expect(body.vehicles[0].latestOdometer).toBe(10200);
  });
});

describe('/api/v1/stats', () => {
  it('computes fill-to-fill consumption correctly', async () => {
    await env.DB.prepare("INSERT INTO vehicles (name, is_default) VALUES ('小绿', 1)").run();
    await env.DB.prepare("INSERT INTO fuel_records (date, odometer, liters, price_total, vehicle_id) VALUES ('2026-05-01', 9000, 10, 97, 1)").run();
    await env.DB.prepare("INSERT INTO fuel_records (date, odometer, liters, price_total, vehicle_id) VALUES ('2026-06-01', 9500, 9, 88, 1)").run();
    await env.DB.prepare("INSERT INTO fuel_records (date, odometer, liters, price_total, vehicle_id) VALUES ('2026-06-15', 10000, 8, 78, 1)").run();

    const res = await SELF.fetch(apiUrl('/api/v1/stats?x=3&days=365'));
    expect(res.status).toBe(200);
    const body = await res.json() as { records: { consumption: number | null }[]; avg: number; totalKm: number };
    // 10L/500km=2.0, 9L/500km=1.8 → totalKm=1000 → avg = 19/1000*100 = 1.9
    expect(body.totalKm).toBe(1000);
    expect(body.avg).toBeCloseTo(1.9, 1);
    expect(body.records[0].consumption).toBeNull();
    expect(body.records[1].consumption).toBeCloseTo(2.0, 1);
  });

  it('filters by vehicle name', async () => {
    await env.DB.prepare("INSERT INTO vehicles (name, is_default) VALUES ('小绿', 1)").run();
    await env.DB.prepare("INSERT INTO vehicles (name, is_default) VALUES ('通勤车', 0)").run();
    await env.DB.prepare("INSERT INTO fuel_records (date, odometer, liters, price_total, vehicle_id) VALUES ('2026-06-01', 10000, 10, 98, 1)").run();
    await env.DB.prepare("INSERT INTO fuel_records (date, odometer, liters, price_total, vehicle_id) VALUES ('2026-06-01', 50000, 5, 40, 2)").run();

    const res = await SELF.fetch(apiUrl('/api/v1/stats?x=4&vehicle=通勤车'));
    const body = await res.json() as { records: unknown[] };
    expect(body.records).toHaveLength(1);
  });
});

describe('/api/v1/reminders', () => {
  it('returns empty when no active reminders', async () => {
    const res = await SELF.fetch(apiUrl('/api/v1/reminders?x=5'));
    const body = await res.json() as { reminders: unknown[] };
    expect(body.reminders).toEqual([]);
  });
});

describe('token auth', () => {
  it('returns 401 without valid token', async () => {
    const res = await SELF.fetch('http://localhost/api/v1/vehicles?token=wrong');
    expect(res.status).toBe(401);
  });
});

describe('/dashboard', () => {
  it('returns HTML page', async () => {
    const res = await SELF.fetch('http://localhost/dashboard');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Moto Agent');
    expect(html).toContain('chart.js@');
  });
});
