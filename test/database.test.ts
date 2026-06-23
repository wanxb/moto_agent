import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  insertFuelRecord, insertMileageRecord,
  getLastFuelRecord, getRecentFuelRecords, getFuelRecordsByDateRange,
} from '../src/database';
import { initDB, clearDB } from './utils';

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

describe('insertFuelRecord / getLastFuelRecord', () => {
  it('saves a record and retrieves it', async () => {
    await insertFuelRecord(env.DB, {
      date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98, fuel_type: '95',
    });
    const r = await getLastFuelRecord(env.DB);
    expect(r).not.toBeNull();
    expect(r!.odometer).toBe(10000);
    expect(r!.liters).toBe(10);
    expect(r!.price_total).toBe(98);
    expect(r!.fuel_type).toBe('95');
  });

  it('returns null when no records exist', async () => {
    const r = await getLastFuelRecord(env.DB);
    expect(r).toBeNull();
  });

  it('getLastFuelRecord returns highest odometer record', async () => {
    await insertFuelRecord(env.DB, { date: '2026-05-01', odometer: 9000, liters: 8, price_total: 80 });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98 });
    const r = await getLastFuelRecord(env.DB);
    expect(r!.odometer).toBe(10000);
  });

  it('saves optional fields correctly', async () => {
    await insertFuelRecord(env.DB, {
      date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98,
      fuel_type: '92', note: '省道加油',
    });
    const r = await getLastFuelRecord(env.DB);
    expect(r!.fuel_type).toBe('92');
    expect(r!.note).toBe('省道加油');
  });
});

describe('getRecentFuelRecords', () => {
  it('returns records ordered by odometer descending', async () => {
    await insertFuelRecord(env.DB, { date: '2026-04-01', odometer: 8000, liters: 8, price_total: 78 });
    await insertFuelRecord(env.DB, { date: '2026-05-01', odometer: 9000, liters: 9, price_total: 88 });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98 });

    const records = await getRecentFuelRecords(env.DB, 2);
    expect(records).toHaveLength(2);
    expect(records[0].odometer).toBe(10000);
    expect(records[1].odometer).toBe(9000);
  });
});

describe('getFuelRecordsByDateRange', () => {
  it('filters by date range (inclusive)', async () => {
    await insertFuelRecord(env.DB, { date: '2026-04-01', odometer: 8000, liters: 8, price_total: 78 });
    await insertFuelRecord(env.DB, { date: '2026-05-15', odometer: 9000, liters: 9, price_total: 88 });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98 });

    const records = await getFuelRecordsByDateRange(env.DB, '2026-05-01', '2026-05-31');
    expect(records).toHaveLength(1);
    expect(records[0].date).toBe('2026-05-15');
  });

  it('returns records ordered by odometer ascending', async () => {
    await insertFuelRecord(env.DB, { date: '2026-05-20', odometer: 9500, liters: 9, price_total: 88 });
    await insertFuelRecord(env.DB, { date: '2026-05-01', odometer: 9000, liters: 8, price_total: 78 });

    const records = await getFuelRecordsByDateRange(env.DB, '2026-05-01', '2026-05-31');
    expect(records[0].odometer).toBe(9000);
    expect(records[1].odometer).toBe(9500);
  });
});

describe('insertMileageRecord', () => {
  it('inserts without error', async () => {
    await expect(
      insertMileageRecord(env.DB, { date: '2026-06-10', odometer: 10500, note: '周末骑行' })
    ).resolves.not.toThrow();
  });
});
