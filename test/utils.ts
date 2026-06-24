// Shared test utilities

export async function initDB(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS vehicles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
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
  ]);
}

export async function clearDB(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM fuel_records'),
    db.prepare('DELETE FROM mileage_records'),
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
