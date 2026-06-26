import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { dispatchTool } from '../src/tools';
import {
  insertVehicle, insertFuelRecord,
  getLastFuelRecord, getRecentFuelRecords, getFuelRecordsByDateRange, getLatestOdometer,
  updateFuelRecord, softDeleteFuelRecord,
} from '../src/database';
import { initDB, clearDB } from './utils';

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

// ── database: updateFuelRecord ────────────────────────────────────────────────

describe('updateFuelRecord', () => {
  it('updates only provided whitelisted fields', async () => {
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 12580, liters: 10, price_total: 98, fuel_type: '95' });
    const rec = await getLastFuelRecord(env.DB);

    const changed = await updateFuelRecord(env.DB, rec!.id, { odometer: 12680 });
    expect(changed).toBe(1);
    const after = await getLastFuelRecord(env.DB);
    expect(after!.odometer).toBe(12680);
    expect(after!.liters).toBe(10);          // 未改
    expect(after!.fuel_type).toBe('95');     // 未改
  });

  it('ignores non-whitelisted keys and no-op when empty', async () => {
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 100, liters: 10, price_total: 98 });
    const rec = await getLastFuelRecord(env.DB);
    expect(await updateFuelRecord(env.DB, rec!.id, { id: 999, vehicle_id: 5, evil: 1 })).toBe(0);
    expect(await updateFuelRecord(env.DB, rec!.id, {})).toBe(0);
    const after = await getLastFuelRecord(env.DB);
    expect(after!.id).toBe(rec!.id);         // id 没被改
  });
});

// ── database: soft delete filtering ───────────────────────────────────────────

describe('softDeleteFuelRecord filtering', () => {
  it('soft-deleted record disappears from all read paths', async () => {
    await insertFuelRecord(env.DB, { date: '2026-05-01', odometer: 9000, liters: 10, price_total: 97 });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 9, price_total: 88 });
    const last = await getLastFuelRecord(env.DB);
    expect(last!.odometer).toBe(10000);

    await softDeleteFuelRecord(env.DB, last!.id, '2026-06-02T00:00:00Z');

    // last 回退到上一条
    expect((await getLastFuelRecord(env.DB))!.odometer).toBe(9000);
    // recent 不含
    expect((await getRecentFuelRecords(env.DB, 10)).map(r => r.odometer)).not.toContain(10000);
    // date range 不含
    expect((await getFuelRecordsByDateRange(env.DB, '2026-01-01', '2026-12-31')).map(r => r.odometer)).not.toContain(10000);
    // latest odometer 不含被删的高里程
    expect(await getLatestOdometer(env.DB)).toBe(9000);
  });
});

// ── tools: update_last_fuel ───────────────────────────────────────────────────

describe('update_last_fuel (tools)', () => {
  it('AC1 — change a single field (odometer)', async () => {
    await dispatchTool('log_fuel', { date: '2026-06-18', odometer: 12580, liters: 10, price_total: 98 }, env.DB);
    const result = await dispatchTool('update_last_fuel', { odometer: 12680 }, env.DB);
    expect(result).toContain('✏️ 已修改最近一条加油记录');
    expect(result).toContain('12,680');
    expect((await getLastFuelRecord(env.DB))!.odometer).toBe(12680);
  });

  it('AC2 — change multiple fields', async () => {
    await dispatchTool('log_fuel', { date: '2026-06-18', odometer: 12580, liters: 10, price_total: 98 }, env.DB);
    const result = await dispatchTool('update_last_fuel', { liters: 9, price_total: 88 }, env.DB);
    const rec = await getLastFuelRecord(env.DB);
    expect(rec!.liters).toBe(9);
    expect(rec!.price_total).toBe(88);
    expect(result).toContain('¥88');
  });

  it('AC3 — no record to edit', async () => {
    const result = await dispatchTool('update_last_fuel', { odometer: 100 }, env.DB);
    expect(result).toContain('没有可修改');
  });

  it('AC4 — no field specified', async () => {
    await dispatchTool('log_fuel', { date: '2026-06-18', odometer: 12580, liters: 10, price_total: 98 }, env.DB);
    const result = await dispatchTool('update_last_fuel', {}, env.DB);
    expect(result).toContain('请说明要修改什么');
  });

  it('AC7 — edits only the named vehicle latest record', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    const commute = await insertVehicle(env.DB, '通勤车', { isDefault: false });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 12580, liters: 10, price_total: 98, vehicle_id: green });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 8200, liters: 5, price_total: 40, vehicle_id: commute });

    await dispatchTool('update_last_fuel', { odometer: 8250, vehicle: '通勤车' }, env.DB);
    expect((await getLastFuelRecord(env.DB, commute))!.odometer).toBe(8250);
    expect((await getLastFuelRecord(env.DB, green))!.odometer).toBe(12580);   // 小绿不受影响
  });
});

// ── tools: delete_last_fuel ───────────────────────────────────────────────────

describe('delete_last_fuel (tools)', () => {
  it('AC5/AC6 — soft delete then last falls back to previous (spec 017 二次确认)', async () => {
    await dispatchTool('log_fuel', { date: '2026-05-01', odometer: 9000, liters: 10, price_total: 97 }, env.DB);
    await dispatchTool('log_fuel', { date: '2026-06-01', odometer: 10000, liters: 9, price_total: 88 }, env.DB);

    // 第一步：不带 confirm 仅返回预览，不删
    const preview = await dispatchTool('delete_last_fuel', {}, env.DB);
    expect(preview).toContain('确定删除');
    expect(preview).toContain('10,000');
    expect((await getLastFuelRecord(env.DB))!.odometer).toBe(10000);   // 仍在

    // 第二步：confirm=true 执行软删
    const result = await dispatchTool('delete_last_fuel', { confirm: true }, env.DB);
    expect(result).toContain('🗑 已删除最近一条加油记录');
    expect(result).toContain('10,000');

    expect((await getLastFuelRecord(env.DB))!.odometer).toBe(9000);
    // 统计不再含被删记录
    const stats = await dispatchTool('query_stats', { mode: 'recent', count: 10 }, env.DB);
    expect(stats).not.toContain('10000');
  });

  it('AC8 — no record to delete', async () => {
    const result = await dispatchTool('delete_last_fuel', {}, env.DB);
    expect(result).toContain('没有可删除');
  });

  it('deleted record no longer triggers a mileage reminder', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    await dispatchTool('set_reminder', { type: '机油', mode: 'mileage', trigger_odometer: 13000, vehicle: '小绿' }, env.DB);
    // 误填高里程触发条件
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 13500, liters: 10, price_total: 98, vehicle_id: green });
    expect(await getLatestOdometer(env.DB, green)).toBe(13500);

    await dispatchTool('delete_last_fuel', { vehicle: '小绿', confirm: true }, env.DB);
    expect(await getLatestOdometer(env.DB, green)).toBeNull();   // 删后无有效里程
  });
});
