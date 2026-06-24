// Shared test utilities

export async function initDB(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS vehicles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      alias       TEXT,
      brand       TEXT,
      model       TEXT,
      fuel_type   TEXT,
      tank_capacity REAL,
      color       TEXT,
      is_default  INTEGER NOT NULL DEFAULT 0,
      is_active   INTEGER NOT NULL DEFAULT 1,
      user_id     INTEGER,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fuel_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      odometer    REAL    NOT NULL,
      liters      REAL    NOT NULL,
      price_total REAL    NOT NULL,
      fuel_type   TEXT    NOT NULL DEFAULT '95',
      note        TEXT,
      vehicle_id  INTEGER,
      deleted_at  TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS mileage_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      odometer    REAL    NOT NULL,
      note        TEXT,
      vehicle_id  INTEGER,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS maintenance_records (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      type        TEXT    NOT NULL,
      odometer    REAL,
      cost        REAL,
      note        TEXT,
      vehicle_id  INTEGER,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS reminders (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      vehicle_id       INTEGER,
      type             TEXT    NOT NULL,
      mode             TEXT    NOT NULL,
      trigger_odometer REAL,
      trigger_date     TEXT,
      interval_km      REAL,
      note             TEXT,
      chat_id          TEXT,
      status           TEXT    NOT NULL DEFAULT 'active',
      fired_at         TEXT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    )`),
  ]);
}

export async function clearDB(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM fuel_records'),
    db.prepare('DELETE FROM mileage_records'),
    db.prepare('DELETE FROM maintenance_records'),
    db.prepare('DELETE FROM reminders'),
    db.prepare('DELETE FROM vehicles'),
  ]);
}

// Build a minimal Env object for unit tests that only need DB + LLM keys
export function makeEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    SESSION_KV: kv,
    DEEPSEEK_API_KEY:        'test-ds-key',
    ANTHROPIC_API_KEY:       'test-ant-key',
    TELEGRAM_BOT_TOKEN:      'test-token',
    TELEGRAM_WEBHOOK_SECRET: 'test-secret',
    ALLOWED_CHAT_ID:         '999999',
  } as unknown as Env;
}

// Import type so TypeScript is happy
import type { Env } from '../src/types';
export type { Env };
