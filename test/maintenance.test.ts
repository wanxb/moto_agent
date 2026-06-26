import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { dispatchTool } from '../src/tools';
import {
  insertVehicle, getVehicleByName,
  insertMaintenanceRecord, getMaintenanceRecords, getLastMaintenanceByType,
  softDeleteMaintenanceRecord, findMaintenanceRecords,
} from '../src/database';
import { initDB, clearDB } from './utils';

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

// ── database layer ────────────────────────────────────────────────────────────

describe('maintenance database layer', () => {
  it('inserts and retrieves, ordered date DESC', async () => {
    await insertMaintenanceRecord(env.DB, { date: '2026-01-05', type: '保险', cost: 1200 });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-24', type: '机油', odometer: 13000, cost: 80 });
    const all = await getMaintenanceRecords(env.DB);
    expect(all).toHaveLength(2);
    expect(all[0].date).toBe('2026-06-24');   // 最新在前
    expect(all[1].type).toBe('保险');
    expect(all[1].odometer).toBeNull();         // 保险无里程
  });

  it('filters by vehicle and by type', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    const commute = await insertVehicle(env.DB, '通勤车', { isDefault: false });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-01', type: '机油', vehicle_id: green });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-02', type: '轮胎', vehicle_id: green });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-03', type: '机油', vehicle_id: commute });

    expect(await getMaintenanceRecords(env.DB, { vehicleId: green })).toHaveLength(2);
    expect(await getMaintenanceRecords(env.DB, { vehicleId: green, type: '机油' })).toHaveLength(1);
  });

  it('getLastMaintenanceByType returns the latest of a type', async () => {
    await insertMaintenanceRecord(env.DB, { date: '2026-03-01', type: '机油', odometer: 9000 });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-01', type: '机油', odometer: 12000 });
    const last = await getLastMaintenanceByType(env.DB, '机油');
    expect(last!.odometer).toBe(12000);
  });
});

// ── tools: log_maintenance ────────────────────────────────────────────────────

describe('log_maintenance (tools)', () => {
  it('AC1 — records to default vehicle with odometer + cost', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('log_maintenance', {
      date: '2026-06-24', type: '机油', odometer: 13000, cost: 80,
    }, env.DB);
    expect(result).toContain('✅ 已记录保养（小绿）');
    expect(result).toContain('机油');
    expect(result).toContain('13,000 km');
    expect(result).toContain('¥80');

    const recs = await getMaintenanceRecords(env.DB, { vehicleId: (await getVehicleByName(env.DB, '小绿'))!.id });
    expect(recs).toHaveLength(1);
  });

  it('AC2 — records to named vehicle', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    await dispatchTool('add_vehicle', { name: '通勤车' }, env.DB);
    const result = await dispatchTool('log_maintenance', {
      date: '2026-06-24', type: '轮胎', cost: 200, vehicle: '通勤车',
    }, env.DB);
    expect(result).toContain('✅ 已记录保养（通勤车）');
    expect(result).toContain('轮胎');
    expect(result).toContain('—');   // 无里程显示 —
  });

  it('AC3 — no-odometer maintenance (insurance)', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('log_maintenance', {
      date: '2026-01-05', type: '保险', cost: 1200,
    }, env.DB);
    expect(result).toContain('保险');
    expect(result).toContain('¥1200');
  });

  it('AC6 — ambiguous when multiple vehicles and no default', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: false });
    await insertVehicle(env.DB, '通勤车', { isDefault: false });
    const result = await dispatchTool('log_maintenance', {
      date: '2026-06-24', type: '机油', odometer: 13000,
    }, env.DB);
    expect(result).toContain('请指明记到哪辆车');
  });

  it('legacy — works with no vehicles (single-vehicle mode)', async () => {
    const result = await dispatchTool('log_maintenance', {
      date: '2026-06-24', type: '机油', odometer: 13000, cost: 80,
    }, env.DB);
    expect(result).toContain('✅ 已记录保养');
    expect(result).not.toContain('（');   // 无车名后缀
  });
});

// ── tools: query_maintenance ──────────────────────────────────────────────────

describe('query_maintenance (tools)', () => {
  it('AC4 — lists history for a vehicle', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    await insertMaintenanceRecord(env.DB, { date: '2026-01-05', type: '保险', cost: 1200, vehicle_id: green });
    await insertMaintenanceRecord(env.DB, { date: '2026-04-10', type: '轮胎', odometer: 11200, cost: 420, vehicle_id: green });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-24', type: '机油', odometer: 13000, cost: 80, vehicle_id: green });

    const result = await dispatchTool('query_maintenance', { vehicle: '小绿' }, env.DB);
    expect(result).toContain('🔧 小绿 · 保养记录');
    expect(result).toContain('机油');
    expect(result).toContain('轮胎');
    expect(result).toContain('保险');
    // 最新在前
    expect(result.indexOf('2026-06-24')).toBeLessThan(result.indexOf('2026-01-05'));
  });

  it('AC5 — last_only returns latest of a type', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    await insertMaintenanceRecord(env.DB, { date: '2026-03-01', type: '机油', odometer: 9000, cost: 70, vehicle_id: green });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-24', type: '机油', odometer: 13000, cost: 80, vehicle_id: green });

    const result = await dispatchTool('query_maintenance', { type: '机油', last_only: true, vehicle: '小绿' }, env.DB);
    expect(result).toContain('🔧 最近一次「机油」（小绿）');
    expect(result).toContain('13,000 km');
    expect(result).not.toContain('9,000');
  });

  it('returns empty message when no records', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('query_maintenance', { vehicle: '小绿' }, env.DB);
    expect(result).toContain('暂无');
  });

  it('last_only with no matching type', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('query_maintenance', { type: '机油', last_only: true, vehicle: '小绿' }, env.DB);
    expect(result).toContain('暂无「机油」保养记录');
  });
});

// ── soft delete (spec 017) ────────────────────────────────────────────────────

describe('maintenance soft delete (spec 017)', () => {
  it('softDeleteMaintenanceRecord excludes the row from all read paths', async () => {
    await insertMaintenanceRecord(env.DB, { date: '2026-06-01', type: '机油', odometer: 12000 });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-10', type: '机油', odometer: 12500 });
    const before = await getMaintenanceRecords(env.DB, { type: '机油' });
    expect(before).toHaveLength(2);

    await softDeleteMaintenanceRecord(env.DB, before[0].id, new Date().toISOString());

    const after = await getMaintenanceRecords(env.DB, { type: '机油' });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[1].id);
    // findMaintenanceRecords 也只返回活跃记录
    expect(await findMaintenanceRecords(env.DB, { type: '机油' })).toHaveLength(1);
    // 最近一次也回退到未删除那条
    expect((await getLastMaintenanceByType(env.DB, '机油'))!.id).toBe(before[1].id);
  });
});

// ── dedup soft-intercept on log_maintenance (spec 017) ────────────────────────

describe('log_maintenance dedup (spec 017)', () => {
  it('warns and does NOT write when same type within ±1 day', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    await dispatchTool('log_maintenance', { date: '2026-06-25', type: '轮胎', note: '补胎' }, env.DB);

    const result = await dispatchTool('log_maintenance', { date: '2026-06-25', type: '轮胎', note: '补胎' }, env.DB);
    expect(result).toContain('疑似重复');

    // 第二条没有落库
    expect(await getMaintenanceRecords(env.DB, { type: '轮胎' })).toHaveLength(1);
  });

  it('confirm=true bypasses the dedup check and writes', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    await dispatchTool('log_maintenance', { date: '2026-06-25', type: '轮胎' }, env.DB);
    const result = await dispatchTool('log_maintenance', { date: '2026-06-25', type: '轮胎', confirm: true }, env.DB);
    expect(result).toContain('✅ 已记录保养');
    expect(await getMaintenanceRecords(env.DB, { type: '轮胎' })).toHaveLength(2);
  });

  it('different type on same day is not a duplicate', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    await dispatchTool('log_maintenance', { date: '2026-06-25', type: '机油' }, env.DB);
    const result = await dispatchTool('log_maintenance', { date: '2026-06-25', type: '轮胎' }, env.DB);
    expect(result).toContain('✅ 已记录保养');
  });
});

// ── delete_maintenance (spec 017) ─────────────────────────────────────────────

describe('delete_maintenance (spec 017)', () => {
  it('two-step: preview without confirm does not delete, confirm=true deletes', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    await insertMaintenanceRecord(env.DB, { date: '2026-06-01', type: '机油', odometer: 12000,
      vehicle_id: (await getVehicleByName(env.DB, '小绿'))!.id });

    const preview = await dispatchTool('delete_maintenance', { type: '机油', date: '2026-06-01' }, env.DB);
    expect(preview).toContain('确定删除');
    expect(await getMaintenanceRecords(env.DB, { type: '机油' })).toHaveLength(1);   // 未删

    const done = await dispatchTool('delete_maintenance', { type: '机油', date: '2026-06-01', confirm: true }, env.DB);
    expect(done).toContain('🗑 已删除保养记录');
    expect(await getMaintenanceRecords(env.DB, { type: '机油' })).toHaveLength(0);   // 已删
  });

  it('not found when nothing matches', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('delete_maintenance', { type: '机油', date: '2099-01-01' }, env.DB);
    expect(result).toContain('没有找到');
  });

  it('multiple matches without keep_one asks to narrow', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-25', type: '轮胎', note: '补胎A', vehicle_id: green });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-25', type: '轮胎', note: '补胎B', vehicle_id: green });
    const result = await dispatchTool('delete_maintenance', { type: '轮胎', date: '2026-06-25' }, env.DB);
    expect(result).toContain('找到多条');
    expect(await getMaintenanceRecords(env.DB, { type: '轮胎' })).toHaveLength(2);   // 未删
  });

  it('keep_one removes all but the earliest after confirm', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-25', type: '轮胎', note: '后胎扎钉补胎', vehicle_id: green });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-25', type: '轮胎', note: '后胎被扎补胎', vehicle_id: green });

    const preview = await dispatchTool('delete_maintenance', { type: '轮胎', date: '2026-06-25', keep_one: true }, env.DB);
    expect(preview).toContain('保留最早一条');
    expect(await getMaintenanceRecords(env.DB, { type: '轮胎' })).toHaveLength(2);   // 未删

    const done = await dispatchTool('delete_maintenance', { type: '轮胎', date: '2026-06-25', keep_one: true, confirm: true }, env.DB);
    expect(done).toContain('已删除 1 条重复');
    const left = await getMaintenanceRecords(env.DB, { type: '轮胎' });
    expect(left).toHaveLength(1);
    expect(left[0].note).toBe('后胎扎钉补胎');   // 保留最早插入的那条
  });
});
