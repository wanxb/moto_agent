import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import {
  insertVehicle, getVehicleByName, listVehicles, updateVehicle,
  getVehicleMostUsedFuelType, insertFuelRecord,
} from '../src/database';

beforeAll(async () => {
  // users 表：resolveApiUser 会按 ?token= 查管理员；无 users 表会报错。
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, telegram_id TEXT UNIQUE, nickname TEXT, lang TEXT NOT NULL DEFAULT 'zh', is_admin INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login TEXT)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, alias TEXT,
    brand TEXT, model TEXT, fuel_type TEXT, tank_capacity REAL, color TEXT,
    is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1,
    user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS fuel_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, odometer REAL NOT NULL, liters REAL NOT NULL,
    price_total REAL NOT NULL, fuel_type TEXT NOT NULL DEFAULT '95',
    note TEXT, vehicle_id INTEGER, deleted_at TEXT, user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM fuel_records').run();
  await env.DB.prepare('DELETE FROM vehicles').run();
});

// ── T2: insertVehicle 支持新属性 ──────────────────────────────────────────────

describe('insertVehicle with new attributes', () => {
  it('AC1 — inserts vehicle with all 5 new attributes', async () => {
    const id = await insertVehicle(env.DB, '小绿', {
      isDefault: true, brand: '本田', model: 'CBF190',
      fuel_type: '95', tank_capacity: 12, color: '白色',
    });
    const v = await getVehicleByName(env.DB, '小绿');
    expect(v).not.toBeNull();
    expect(v!.brand).toBe('本田');
    expect(v!.model).toBe('CBF190');
    expect(v!.fuel_type).toBe('95');
    expect(v!.tank_capacity).toBe(12);
    expect(v!.color).toBe('白色');
    expect(v!.is_default).toBe(1);
  });

  it('AC2 — inserts vehicle without new attributes (all null)', async () => {
    const id = await insertVehicle(env.DB, '通勤车');
    const v = await getVehicleByName(env.DB, '通勤车');
    expect(v).not.toBeNull();
    expect(v!.brand).toBeNull();
    expect(v!.model).toBeNull();
    expect(v!.fuel_type).toBeNull();
    expect(v!.tank_capacity).toBeNull();
    expect(v!.color).toBeNull();
  });

  it('inserts vehicle with partial attributes', async () => {
    await insertVehicle(env.DB, '小蓝', { brand: '雅马哈', color: '蓝色' });
    const v = await getVehicleByName(env.DB, '小蓝');
    expect(v!.brand).toBe('雅马哈');
    expect(v!.color).toBe('蓝色');
    expect(v!.model).toBeNull();
    expect(v!.fuel_type).toBeNull();
  });
});

// ── T3: updateVehicle ─────────────────────────────────────────────────────────

describe('updateVehicle', () => {
  it('AC8 — updates single attribute', async () => {
    const id = await insertVehicle(env.DB, '小绿', { brand: '本田' });
    await updateVehicle(env.DB, id, { model: 'CBF190X' });
    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.brand).toBe('本田'); // unchanged
    expect(v!.model).toBe('CBF190X');
  });

  it('updates multiple attributes at once', async () => {
    const id = await insertVehicle(env.DB, '小绿');
    await updateVehicle(env.DB, id, { brand: '本田', model: 'CBF190', color: '白色' });
    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.brand).toBe('本田');
    expect(v!.model).toBe('CBF190');
    expect(v!.color).toBe('白色');
  });

  it('AC9 — clears attribute with empty string', async () => {
    const id = await insertVehicle(env.DB, '小绿', { color: '白色' });
    await updateVehicle(env.DB, id, { color: '' });
    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.color).toBeNull();
  });

  it('updates fuel_type attribute', async () => {
    const id = await insertVehicle(env.DB, '小绿', { fuel_type: '92' });
    await updateVehicle(env.DB, id, { fuel_type: '95' });
    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.fuel_type).toBe('95');
  });

  it('updates tank_capacity attribute', async () => {
    const id = await insertVehicle(env.DB, '小绿', { tank_capacity: 10 });
    await updateVehicle(env.DB, id, { tank_capacity: 14 });
    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.tank_capacity).toBe(14);
  });

  it('returns 0 changes when no fields provided', async () => {
    const id = await insertVehicle(env.DB, '小绿');
    const changes = await updateVehicle(env.DB, id, {});
    expect(changes).toBe(0);
  });
});

// ── T3: update_vehicle tool ───────────────────────────────────────────────────

const TOKEN = '999999';
function apiUrl(path: string) { return `http://localhost${path}&token=${TOKEN}`; }

describe('update_vehicle tool via agent dispatch', () => {
  it('AC8 — modifies vehicle brand and color', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true, brand: '本田', color: '白色' });

    // Use the tool registry directly to test
    const { registry } = await import('../src/tools/index');
    const result = await registry.dispatch('update_vehicle', {
      name: '小绿', brand: '雅马哈', color: '红色',
    }, env.DB);

    expect(result).toContain('✅');
    expect(result).toContain('小绿');
    expect(result).toContain('品牌');
    expect(result).toContain('雅马哈');

    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.brand).toBe('雅马哈');
    expect(v!.color).toBe('红色');
  });

  it('AC9 — clears attribute with empty string via tool', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true, color: '白色' });
    const { registry } = await import('../src/tools/index');
    const result = await registry.dispatch('update_vehicle', { name: '小绿', color: '' }, env.DB);
    expect(result).toContain('已清空');
    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.color).toBeNull();
  });

  it('errors on unknown vehicle', async () => {
    const { registry } = await import('../src/tools/index');
    const result = await registry.dispatch('update_vehicle', { name: '不存在', brand: '本田' }, env.DB);
    expect(result).toContain('没有找到');
  });

  it('errors when no attribute provided', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true });
    const { registry } = await import('../src/tools/index');
    const result = await registry.dispatch('update_vehicle', { name: '小绿' }, env.DB);
    expect(result).toContain('至少指定一个');
  });

  it('AC10 — resolves vehicle by alias', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true });
    const { setVehicleAlias } = await import('../src/database');
    await setVehicleAlias(env.DB, 1, '通勤车');
    const { registry } = await import('../src/tools/index');
    const result = await registry.dispatch('update_vehicle', { name: '通勤车', tank_capacity: 14 }, env.DB);
    expect(result).toContain('小绿');
    expect(result).toContain('油箱容量');
    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.tank_capacity).toBe(14);
  });
});

// ── T4: add_vehicle tool 支持新属性 ────────────────────────────────────────────

describe('add_vehicle tool with new attributes', () => {
  it('AC1 — creates vehicle with all 5 new attributes via tool', async () => {
    const { registry } = await import('../src/tools/index');
    const result = await registry.dispatch('add_vehicle', {
      name: '小绿', brand: '本田', model: 'CBF190',
      fuel_type: '95', tank_capacity: 12, color: '白色',
    }, env.DB);
    expect(result).toContain('✅');

    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.brand).toBe('本田');
    expect(v!.model).toBe('CBF190');
    expect(v!.fuel_type).toBe('95');
    expect(v!.tank_capacity).toBe(12);
    expect(v!.color).toBe('白色');
  });

  it('AC2 — creates vehicle without new attributes', async () => {
    const { registry } = await import('../src/tools/index');
    const result = await registry.dispatch('add_vehicle', { name: '小绿' }, env.DB);
    expect(result).toContain('✅');
    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.brand).toBeNull();
    expect(v!.fuel_type).toBeNull();
  });
});

// ── T4: log_fuel 默认油号 ─────────────────────────────────────────────────────

describe('log_fuel default fuel_type', () => {
  it('AC3 — uses vehicle fuel_type when not specified', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true, fuel_type: '98' });
    const { registry } = await import('../src/tools/index');
    await registry.dispatch('log_fuel', {
      date: '2026-06-01', odometer: 10000, liters: 10, price_total: 100,
    }, env.DB);

    const { getLastFuelRecord } = await import('../src/database');
    const rec = await getLastFuelRecord(env.DB, 1);
    expect(rec!.fuel_type).toBe('98'); // 继承车辆默认值
  });

  it('AC4 — user-specified fuel_type overrides vehicle default', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true, fuel_type: '98' });
    const { registry } = await import('../src/tools/index');
    await registry.dispatch('log_fuel', {
      date: '2026-06-01', odometer: 10000, liters: 10, price_total: 100, fuel_type: '92',
    }, env.DB);

    const { getLastFuelRecord } = await import('../src/database');
    const rec = await getLastFuelRecord(env.DB, 1);
    expect(rec!.fuel_type).toBe('92'); // 用户明确说的优先
  });

  it('AC5 — falls back to 95 when vehicle has no fuel_type and none specified', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true, fuel_type: null as any });
    const { registry } = await import('../src/tools/index');
    await registry.dispatch('log_fuel', {
      date: '2026-06-01', odometer: 10000, liters: 10, price_total: 100,
    }, env.DB);

    const { getLastFuelRecord } = await import('../src/database');
    const rec = await getLastFuelRecord(env.DB, 1);
    expect(rec!.fuel_type).toBe('95'); // 系统默认
  });
});

// ── T4: log_fuel 油号自动更新 ──────────────────────────────────────────────────

describe('log_fuel auto-update vehicle fuel_type', () => {
  it('AC6 — auto-updates when most used fuel_type differs and count >= 3', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true, fuel_type: '92' });

    // 记录 3 次 95 号油
    const { registry } = await import('../src/tools/index');
    for (const [odometer, liters, price] of [[10000, 10, 100], [10500, 9, 90], [11000, 8, 80]] as const) {
      await registry.dispatch('log_fuel', {
        date: '2026-06-15', odometer, liters, price_total: price, fuel_type: '95',
      }, env.DB);
    }

    // 车辆 fuel_type 应自动从 92 更新为 95（第 3 次触发）
    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.fuel_type).toBe('95');
  });

  it('AC7 — does NOT auto-update when threshold not reached (only 2 out of 5)', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true, fuel_type: '92' });

    const { registry } = await import('../src/tools/index');
    // 2 次 95
    for (const [odometer, liters, price] of [[10000, 10, 100], [10500, 9, 90]] as const) {
      await registry.dispatch('log_fuel', {
        date: '2026-06-15', odometer, liters, price_total: price, fuel_type: '95',
      }, env.DB);
    }
    // 1 次 92
    await registry.dispatch('log_fuel', {
      date: '2026-06-15', odometer: 10800, liters: 8, price_total: 80, fuel_type: '92',
    }, env.DB);

    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.fuel_type).toBe('92'); // 不变，95 只有 2 次
  });

  it('does not auto-update when fuel_type is already the same', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true, fuel_type: '95' });

    const { registry } = await import('../src/tools/index');
    for (const [odometer, liters, price] of [[10000, 10, 100], [10500, 9, 90], [11000, 8, 80]] as const) {
      await registry.dispatch('log_fuel', {
        date: '2026-06-15', odometer, liters, price_total: price, fuel_type: '95',
      }, env.DB);
    }

    const v = await getVehicleByName(env.DB, '小绿');
    expect(v!.fuel_type).toBe('95'); // 没变，本来就是 95
  });
});

// ── getVehicleMostUsedFuelType ────────────────────────────────────────────────

describe('getVehicleMostUsedFuelType', () => {
  it('returns most common fuel_type among last 5 records', async () => {
    const vid = await insertVehicle(env.DB, '小绿');

    // 3 条 95, 2 条 92
    for (const [date, fuel] of [
      ['2026-06-01', '95'], ['2026-06-02', '92'],
      ['2026-06-03', '95'], ['2026-06-04', '95'], ['2026-06-05', '92'],
    ] as const) {
      await insertFuelRecord(env.DB, {
        date, odometer: 10000, liters: 10, price_total: 100, fuel_type: fuel, vehicle_id: vid,
      });
    }

    const result = await getVehicleMostUsedFuelType(env.DB, vid);
    expect(result).not.toBeNull();
    expect(result!.fuel_type).toBe('95');
    expect(result!.count).toBe(3);
  });

  it('returns null when no records', async () => {
    const vid = await insertVehicle(env.DB, '小绿');
    const result = await getVehicleMostUsedFuelType(env.DB, vid);
    expect(result).toBeNull();
  });

  it('only considers last 5 records', async () => {
    const vid = await insertVehicle(env.DB, '小绿');

    // 5 条 92（旧）, 然后 5 条 95（新）
    for (let i = 1; i <= 5; i++) {
      await insertFuelRecord(env.DB, {
        date: '2026-05-0' + i, odometer: 9000 + i * 100, liters: 10,
        price_total: 80, fuel_type: '92', vehicle_id: vid,
      });
    }
    for (let i = 1; i <= 5; i++) {
      await insertFuelRecord(env.DB, {
        date: '2026-06-1' + i, odometer: 10000 + i * 100, liters: 10,
        price_total: 100, fuel_type: '95', vehicle_id: vid,
      });
    }

    // 最近 5 条全部是 95
    const result = await getVehicleMostUsedFuelType(env.DB, vid);
    expect(result!.fuel_type).toBe('95');
    expect(result!.count).toBe(5);
  });
});

// ── Dashboard API ─────────────────────────────────────────────────────────────

describe('/api/v1/vehicles returns new attributes', () => {
  it('returns brand, model, fuel_type, tank_capacity, color', async () => {
    await insertVehicle(env.DB, '小绿', {
      isDefault: true, brand: '本田', model: 'CBF190',
      fuel_type: '95', tank_capacity: 12, color: '白色',
    });

    const res = await SELF.fetch(apiUrl('/api/v1/vehicles?x=1'));
    expect(res.status).toBe(200);
    const body = await res.json() as { vehicles: { brand: string | null; model: string | null; fuel_type: string | null; tank_capacity: number | null; color: string | null }[] };
    expect(body.vehicles).toHaveLength(1);
    expect(body.vehicles[0].brand).toBe('本田');
    expect(body.vehicles[0].model).toBe('CBF190');
    expect(body.vehicles[0].fuel_type).toBe('95');
    expect(body.vehicles[0].tank_capacity).toBe(12);
    expect(body.vehicles[0].color).toBe('白色');
  });

  it('returns null for unset attributes', async () => {
    await insertVehicle(env.DB, '小绿', { isDefault: true });

    const res = await SELF.fetch(apiUrl('/api/v1/vehicles?x=2'));
    const body = await res.json() as { vehicles: { brand: string | null; model: string | null; fuel_type: string | null }[] };
    expect(body.vehicles[0].brand).toBeNull();
    expect(body.vehicles[0].model).toBeNull();
    expect(body.vehicles[0].fuel_type).toBeNull();
  });
});
