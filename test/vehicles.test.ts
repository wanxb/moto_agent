import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { dispatchTool } from '../src/tools';
import {
  insertVehicle, getVehicleByName, listVehicles, getDefaultVehicle,
  countVehicles, setDefaultVehicle, insertFuelRecord, getLastFuelRecord,
} from '../src/database';
import { initDB, clearDB } from './utils';

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

// ── database: vehicles CRUD ───────────────────────────────────────────────────

describe('vehicles CRUD (database)', () => {
  it('insertVehicle returns id and getVehicleByName finds it', async () => {
    const id = await insertVehicle(env.DB, '小绿', { isDefault: true });
    expect(id).toBeGreaterThan(0);
    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.id).toBe(id);
    expect(v!.is_default).toBe(1);
  });

  it('getVehicleByName returns null for unknown name', async () => {
    expect(await getVehicleByName(env.DB, '不存在')).toBeNull();
  });

  it('listVehicles and countVehicles reflect active vehicles', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true });
    await insertVehicle(env.DB, '通勤车', { isDefault: false });
    expect(await countVehicles(env.DB)).toBe(2);
    const list = await listVehicles(env.DB);
    expect(list.map(v => v.name)).toEqual(['小绿', '通勤车']);
  });

  it('setDefaultVehicle keeps exactly one default (atomic)', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true });
    const b = await insertVehicle(env.DB, '通勤车', { isDefault: false });
    await setDefaultVehicle(env.DB, b);

    const def = await getDefaultVehicle(env.DB);
    expect(def!.id).toBe(b);
    // 只有一辆 default
    const defaults = (await listVehicles(env.DB)).filter(v => v.is_default === 1);
    expect(defaults).toHaveLength(1);
    expect(await getVehicleByName(env.DB, '小绿').then(v => v!.is_default)).toBe(0);
  });
});

// ── database: per-vehicle record filtering ────────────────────────────────────

describe('per-vehicle record filtering (database)', () => {
  it('getLastFuelRecord filters by vehicle_id (no cross-vehicle mixing)', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    const commute = await insertVehicle(env.DB, '通勤车', { isDefault: false });

    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98, vehicle_id: green });
    await insertFuelRecord(env.DB, { date: '2026-06-02', odometer: 50000, liters: 5, price_total: 40, vehicle_id: commute });

    const lastGreen = await getLastFuelRecord(env.DB, green);
    expect(lastGreen!.odometer).toBe(10000);   // 不会取到通勤车的 50000
    const lastCommute = await getLastFuelRecord(env.DB, commute);
    expect(lastCommute!.odometer).toBe(50000);
  });
});

// ── tools: vehicle management ─────────────────────────────────────────────────

describe('add_vehicle / list_vehicles / set_default_vehicle (tools)', () => {
  it('first vehicle is auto-set as default', async () => {
    const result = await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    expect(result).toContain('已添加车辆「小绿」');
    expect(result).toContain('默认车');
    expect((await getDefaultVehicle(env.DB))!.name).toBe('小绿');
  });

  it('second vehicle is not default', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('add_vehicle', { name: '通勤车' }, env.DB);
    expect(result).toContain('已添加车辆「通勤车」');
    expect(result).not.toContain('默认车');
  });

  it('duplicate vehicle name is rejected', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    expect(result).toContain('已存在');
  });

  it('list_vehicles marks the default', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    await dispatchTool('add_vehicle', { name: '通勤车' }, env.DB);
    const result = await dispatchTool('list_vehicles', {}, env.DB);
    expect(result).toContain('🏍 车辆列表');
    expect(result).toContain('小绿（默认）');
    expect(result).toContain('通勤车');
  });

  it('list_vehicles when empty hints to add one', async () => {
    const result = await dispatchTool('list_vehicles', {}, env.DB);
    expect(result).toContain('还没有车辆');
  });

  it('set_default_vehicle switches default', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    await dispatchTool('add_vehicle', { name: '通勤车' }, env.DB);
    const result = await dispatchTool('set_default_vehicle', { name: '通勤车' }, env.DB);
    expect(result).toContain('已将默认车设为「通勤车」');
    expect((await getDefaultVehicle(env.DB))!.name).toBe('通勤车');
  });

  it('set_default_vehicle on unknown vehicle errors', async () => {
    const result = await dispatchTool('set_default_vehicle', { name: '幽灵车' }, env.DB);
    expect(result).toContain('没有找到车辆');
  });
});

// ── tools: vehicle resolution in log_fuel ─────────────────────────────────────

describe('log_fuel vehicle resolution (tools)', () => {
  it('AC2 — records to default vehicle when none specified', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 12580, liters: 10, price_total: 98,
    }, env.DB);
    expect(result).toContain('✅ 已记录（小绿）');

    const last = await getLastFuelRecord(env.DB, (await getVehicleByName(env.DB, '小绿'))!.id);
    expect(last!.odometer).toBe(12580);
  });

  it('AC3 — records to the named vehicle', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    await dispatchTool('add_vehicle', { name: '通勤车' }, env.DB);
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 8200, liters: 5, price_total: 40, vehicle: '通勤车',
    }, env.DB);
    expect(result).toContain('✅ 已记录（通勤车）');
    expect((await getLastFuelRecord(env.DB, (await getVehicleByName(env.DB, '通勤车'))!.id))!.odometer).toBe(8200);
  });

  it('AC4 — ambiguous when multiple vehicles and no default', async () => {
    // 直接建两辆都非默认的车，制造无默认 + 多车
    await insertVehicle(env.DB, '小绿', { isDefault: false });
    await insertVehicle(env.DB, '通勤车', { isDefault: false });
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 12580, liters: 10, price_total: 98,
    }, env.DB);
    expect(result).toContain('请指明记到哪辆车');
    expect(result).toContain('小绿');
    expect(result).toContain('通勤车');
  });

  it('not_found vehicle name prompts to add it', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 12580, liters: 10, price_total: 98, vehicle: '红色摩托',
    }, env.DB);
    expect(result).toContain('没有找到车辆「红色摩托」');
  });

  it('consumption is computed per-vehicle (no cross-vehicle odometer)', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    await insertVehicle(env.DB, '通勤车', { isDefault: false });
    // 小绿上次 9800km/10L；通勤车一条高里程记录不应干扰
    await insertFuelRecord(env.DB, { date: '2026-05-01', odometer: 9800, liters: 10, price_total: 97, vehicle_id: green });
    await insertFuelRecord(env.DB, { date: '2026-05-02', odometer: 99999, liters: 5, price_total: 40, vehicle_id: (await getVehicleByName(env.DB, '通勤车'))!.id });

    // 小绿到 10000km → 200km on 10L → 5.00
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 10000, liters: 9, price_total: 88, vehicle: '小绿',
    }, env.DB);
    expect(result).toContain('5.00 L/100km');
    expect(result).toContain('200 km');
  });
});

// ── tools: per-vehicle stats ──────────────────────────────────────────────────

describe('query_stats / get_last_record per vehicle (tools)', () => {
  it('AC5 — query_stats only counts the named vehicle', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    const commute = await insertVehicle(env.DB, '通勤车', { isDefault: false });
    // 小绿两条
    await insertFuelRecord(env.DB, { date: '2026-05-01', odometer: 9000, liters: 10, price_total: 97, vehicle_id: green });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 9500, liters: 9, price_total: 88, vehicle_id: green });
    // 通勤车一条（不应进入小绿统计）
    await insertFuelRecord(env.DB, { date: '2026-06-02', odometer: 20000, liters: 5, price_total: 40, vehicle_id: commute });

    const result = await dispatchTool('query_stats', { mode: 'recent', count: 5, vehicle: '小绿' }, env.DB);
    expect(result).toContain('📊 小绿 · 油耗统计');
    expect(result).toContain('2.00 L/100km');   // 10L/500km
    expect(result).not.toContain('20000');
  });

  it('get_last_record returns the named vehicle latest', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    const commute = await insertVehicle(env.DB, '通勤车', { isDefault: false });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 9500, liters: 9, price_total: 88, vehicle_id: green });
    await insertFuelRecord(env.DB, { date: '2026-06-02', odometer: 20000, liters: 5, price_total: 40, vehicle_id: commute });

    const result = await dispatchTool('get_last_record', { vehicle: '通勤车' }, env.DB);
    expect(result).toContain('🕐 最近一次加油（通勤车）');
    expect(result).toContain('20,000');
  });
});

// ── backward compat: single-vehicle / legacy (no vehicles) ────────────────────

describe('legacy single-vehicle mode (no vehicles created)', () => {
  it('log_fuel works without vehicle and shows no vehicle suffix (AC: 不退化)', async () => {
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98,
    }, env.DB);
    expect(result).toContain('✅ 已记录');
    expect(result).not.toContain('（');   // 无车名后缀
  });

  it('query_stats works without vehicles, generic header', async () => {
    await insertFuelRecord(env.DB, { date: '2026-05-01', odometer: 9000, liters: 10, price_total: 97 });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 9500, liters: 9, price_total: 88 });
    const result = await dispatchTool('query_stats', { mode: 'recent', count: 5 }, env.DB);
    expect(result).toContain('📊 油耗统计');
    expect(result).toContain('2.00 L/100km');
  });
});

// ── rename_vehicle (spec 005) ─────────────────────────────────────────────────

describe('rename_vehicle (tools)', () => {
  it('AC-A1 — renames an existing vehicle', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('rename_vehicle', { name: '小绿', new_name: '大绿' }, env.DB);
    expect(result).toContain('已将车辆「小绿」改名为「大绿」');
    expect(await getVehicleByName(env.DB, '大绿')).not.toBeNull();
    expect(await getVehicleByName(env.DB, '小绿')).toBeNull();
  });

  it('AC-A2 — historical records show the new name after rename', async () => {
    const green = await insertVehicle(env.DB, '小绿', { isDefault: true });
    await insertFuelRecord(env.DB, { date: '2026-05-01', odometer: 9000, liters: 10, price_total: 97, vehicle_id: green });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 9500, liters: 9, price_total: 88, vehicle_id: green });

    await dispatchTool('rename_vehicle', { name: '小绿', new_name: '大绿' }, env.DB);
    // 历史记录关联 id，统计表头显示新名
    const stats = await dispatchTool('query_stats', { mode: 'recent', count: 5, vehicle: '大绿' }, env.DB);
    expect(stats).toContain('📊 大绿 · 油耗统计');
    expect(stats).toContain('2.00 L/100km');
  });

  it('AC-A3 — rejects rename to an existing name', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    await dispatchTool('add_vehicle', { name: '通勤车' }, env.DB);
    const result = await dispatchTool('rename_vehicle', { name: '小绿', new_name: '通勤车' }, env.DB);
    expect(result).toContain('已存在车辆「通勤车」');
    expect(await getVehicleByName(env.DB, '小绿')).not.toBeNull();   // 未改
  });

  it('AC-A4 — rejects rename of non-existent vehicle', async () => {
    const result = await dispatchTool('rename_vehicle', { name: '幽灵车', new_name: '大绿' }, env.DB);
    expect(result).toContain('没有找到车辆「幽灵车」');
  });
});
