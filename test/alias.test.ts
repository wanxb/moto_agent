import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { dispatchTool } from '../src/tools';
import {
  insertVehicle, getVehicleByName, getVehicleByNameOrAlias, setVehicleAlias,
  insertFuelRecord, getLastFuelRecord, listVehicles,
} from '../src/database';
import { initDB, clearDB } from './utils';

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

// ── database: getVehicleByNameOrAlias + setVehicleAlias ───────────────────────

describe('vehicle alias database layer', () => {
  it('getVehicleByNameOrAlias matches by name or alias', async () => {
    const id = await insertVehicle(env.DB, 'Honda NS125LA', { isDefault: true });
    await setVehicleAlias(env.DB, id, '小拉');

    expect((await getVehicleByNameOrAlias(env.DB, 'Honda NS125LA'))!.id).toBe(id);
    expect((await getVehicleByNameOrAlias(env.DB, '小拉'))!.id).toBe(id);
    expect(await getVehicleByNameOrAlias(env.DB, '不存在')).toBeNull();
  });

  it('getVehicleByName still works (exact name only)', async () => {
    const id = await insertVehicle(env.DB, 'Honda NS125LA', { isDefault: true });
    await setVehicleAlias(env.DB, id, '小拉');

    expect((await getVehicleByName(env.DB, 'Honda NS125LA'))!.id).toBe(id);
    expect(await getVehicleByName(env.DB, '小拉')).toBeNull();   // 别名不在 name 列
  });
});

// ── tools: set_vehicle_alias ─────────────────────────────────────────────────

describe('set_vehicle_alias (tools)', () => {
  it('AC1 — sets alias for a vehicle', async () => {
    await dispatchTool('add_vehicle', { name: 'Honda NS125LA' }, env.DB);
    const result = await dispatchTool('set_vehicle_alias', { name: 'Honda NS125LA', alias: '小拉' }, env.DB);
    expect(result).toContain('已将「Honda NS125LA」的简称设为「小拉」');
    expect((await getVehicleByName(env.DB, 'Honda NS125LA'))!.alias).toBe('小拉');
  });

  it('removes alias when empty string passed', async () => {
    const id = await insertVehicle(env.DB, 'Honda NS125LA', { isDefault: true });
    await setVehicleAlias(env.DB, id, '小拉');
    await dispatchTool('set_vehicle_alias', { name: 'Honda NS125LA', alias: '' }, env.DB);
    expect((await getVehicleByName(env.DB, 'Honda NS125LA'))!.alias).toBeNull();
  });

  it('AC4 — rejects duplicate alias across vehicles', async () => {
    await dispatchTool('add_vehicle', { name: 'Honda NS125LA' }, env.DB);
    await dispatchTool('add_vehicle', { name: '通勤车' }, env.DB);
    await dispatchTool('set_vehicle_alias', { name: 'Honda NS125LA', alias: '小拉' }, env.DB);

    const result = await dispatchTool('set_vehicle_alias', { name: '通勤车', alias: '小拉' }, env.DB);
    expect(result).toContain('已存在车辆或简称「小拉」');
  });

  it('can locate vehicle by its existing alias', async () => {
    const id = await insertVehicle(env.DB, 'Honda NS125LA', { isDefault: true });
    await setVehicleAlias(env.DB, id, '小拉');
    // 通过别名找到车并改别名
    await dispatchTool('set_vehicle_alias', { name: '小拉', alias: '新小拉' }, env.DB);
    expect((await getVehicleByName(env.DB, 'Honda NS125LA'))!.alias).toBe('新小拉');
  });
});

// ── alias resolution in tools (resolveVehicle) ────────────────────────────────

describe('alias resolution in tools', () => {
  it('AC2 — log_fuel resolves by alias', async () => {
    const id = await insertVehicle(env.DB, 'Honda NS125LA', { isDefault: true });
    await setVehicleAlias(env.DB, id, '小拉');

    const result = await dispatchTool('log_fuel', {
      date: '2026-06-24', odometer: 35000, liters: 5, price_total: 40, vehicle: '小拉',
    }, env.DB);
    expect(result).toContain('✅ 已记录（Honda NS125LA）');   // 回显全名
    expect((await getLastFuelRecord(env.DB, id))!.odometer).toBe(35000);
  });

  it('AC3 — full name still works alongside alias', async () => {
    const id = await insertVehicle(env.DB, 'Honda NS125LA', { isDefault: true });
    await setVehicleAlias(env.DB, id, '小拉');

    const byAlias = await dispatchTool('get_last_record', { vehicle: '小拉' }, env.DB);
    const byName  = await dispatchTool('get_last_record', { vehicle: 'Honda NS125LA' }, env.DB);
    // 都是同一个结果（暂无记录）
    expect(byAlias).toContain('暂无');
    expect(byName).toContain('暂无');
  });

  it('AC5 — list_vehicles shows alias if present', async () => {
    await dispatchTool('add_vehicle', { name: 'Honda NS125LA' }, env.DB);
    await dispatchTool('add_vehicle', { name: '通勤车' }, env.DB);
    await dispatchTool('set_vehicle_alias', { name: 'Honda NS125LA', alias: '小拉' }, env.DB);

    const list = await dispatchTool('list_vehicles', {}, env.DB);
    expect(list).toContain('Honda NS125LA（小拉）');
    expect(list).toContain('通勤车');
    expect(list).not.toContain('通勤车（');   // 无别名的不显示括号
  });

  it('AC6 — rename does not affect alias', async () => {
    const id = await insertVehicle(env.DB, 'Honda NS125LA', { isDefault: true });
    await setVehicleAlias(env.DB, id, '小拉');

    await dispatchTool('rename_vehicle', { name: 'Honda NS125LA', new_name: '大本田' }, env.DB);
    const v = await getVehicleByName(env.DB, '大本田');
    expect(v!.alias).toBe('小拉');           // 别名不变
  });

  it('AC7 — set_default_vehicle by alias', async () => {
    const id = await insertVehicle(env.DB, 'Honda NS125LA', { isDefault: true });
    await insertVehicle(env.DB, '通勤车', { isDefault: false });
    await setVehicleAlias(env.DB, id, '小拉');

    // 先切走默认，再通过别名切回来
    await dispatchTool('set_default_vehicle', { name: '通勤车' }, env.DB);
    const result = await dispatchTool('set_default_vehicle', { name: '小拉' }, env.DB);
    expect(result).toContain('已将默认车设为「Honda NS125LA」');
  });

  it('rename can find vehicle by alias too', async () => {
    const id = await insertVehicle(env.DB, 'Honda NS125LA', { isDefault: true });
    await setVehicleAlias(env.DB, id, '小拉');

    const result = await dispatchTool('rename_vehicle', { name: '小拉', new_name: '大拉' }, env.DB);
    expect(result).toContain('已将车辆「Honda NS125LA」改名为「大拉」');
    expect(await getVehicleByName(env.DB, '大拉')).not.toBeNull();
  });
});
