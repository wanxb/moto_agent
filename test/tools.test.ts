import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { dispatchTool } from '../src/tools';
import { insertFuelRecord } from '../src/database';
import { initDB, clearDB } from './utils';

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

// ── log_fuel ─────────────────────────────────────────────────────────────────

describe('log_fuel', () => {
  it('first record shows 首次记录 (no consumption calculable)', async () => {
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98,
    }, env.DB);

    expect(result).toContain('✅ 已记录');
    expect(result).toContain('10,000');
    expect(result).toContain('9.80');   // price per liter
    expect(result).toContain('首次记录');
  });

  it('second record calculates correct consumption', async () => {
    // First fill: 10L at 9800km
    await insertFuelRecord(env.DB, { date: '2026-05-01', odometer: 9800, liters: 10, price_total: 97 });

    // Second fill: at 10000km → 200km driven on 10L → 5 L/100km
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 10000, liters: 9, price_total: 88,
    }, env.DB);

    expect(result).toContain('5.00 L/100km');
    expect(result).toContain('200 km');
  });

  it('calculates price per liter correctly', async () => {
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 10000, liters: 12.5, price_total: 122.5,
    }, env.DB);
    // 122.5 / 12.5 = 9.80
    expect(result).toContain('9.80');
  });
});

// ── log_mileage ──────────────────────────────────────────────────────────────

describe('log_mileage', () => {
  it('returns confirmation with odometer reading', async () => {
    const result = await dispatchTool('log_mileage', {
      date: '2026-06-10', odometer: 10500,
    }, env.DB);

    expect(result).toContain('✅');
    expect(result).toContain('10,500');
    expect(result).toContain('2026-06-10');
  });
});

// ── get_last_record ──────────────────────────────────────────────────────────

describe('get_last_record', () => {
  it('returns "暂无记录" when empty', async () => {
    const result = await dispatchTool('get_last_record', {}, env.DB);
    expect(result).toContain('暂无');
  });

  it('formats last record correctly', async () => {
    await insertFuelRecord(env.DB, {
      date: '2026-06-18', odometer: 12580, liters: 10, price_total: 98, fuel_type: '95',
    });

    const result = await dispatchTool('get_last_record', {}, env.DB);
    expect(result).toContain('2026-06-18');
    expect(result).toContain('12,580');
    expect(result).toContain('9.80');
    expect(result).toContain('95');
  });
});

// ── query_stats ───────────────────────────────────────────────────────────────

describe('query_stats', () => {
  it('returns message when no records', async () => {
    const result = await dispatchTool('query_stats', { mode: 'recent', count: 5 }, env.DB);
    expect(result).toContain('暂无');
  });

  it('returns message when only 1 record', async () => {
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98 });
    const result = await dispatchTool('query_stats', { mode: 'recent', count: 5 }, env.DB);
    expect(result).toContain('至少 2 条');
  });

  it('calculates correct consumption across records', async () => {
    // Record 1: 10L at 9000km
    await insertFuelRecord(env.DB, { date: '2026-04-01', odometer: 9000, liters: 10, price_total: 97 });
    // Record 2: 9L at 9500km → 10L / 500km = 2.00 L/100km
    await insertFuelRecord(env.DB, { date: '2026-05-01', odometer: 9500, liters: 9, price_total: 88 });
    // Record 3: 8L at 10000km → 9L / 500km = 1.80 L/100km
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 8, price_total: 78 });

    const result = await dispatchTool('query_stats', { mode: 'recent', count: 3 }, env.DB);
    expect(result).toContain('2.00 L/100km');
    expect(result).toContain('1.80 L/100km');
    expect(result).toContain('📊 油耗统计');
  });

  it('filters by date range', async () => {
    await insertFuelRecord(env.DB, { date: '2026-03-01', odometer: 8000, liters: 10, price_total: 97 });
    await insertFuelRecord(env.DB, { date: '2026-05-01', odometer: 9000, liters: 10, price_total: 97 });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98 });

    const result = await dispatchTool('query_stats', {
      mode: 'date_range', start_date: '2026-05-01', end_date: '2026-06-30',
    }, env.DB);

    // Only the May→June interval should appear, not March
    expect(result).toContain('2026-06-01');
    expect(result).not.toContain('2026-05-01\n');  // first record in range is reference, not shown
  });

  it('unknown tool returns error message', async () => {
    const result = await dispatchTool('nonexistent_tool', {}, env.DB);
    expect(result).toContain('未知工具');
  });
});

// ── 真实历史数据验证 ──────────────────────────────────────────────────────────
// 使用 5 条实际加油记录验证油耗计算逻辑是否正确
// 公式：consumption = prev.liters / distance * 100（fill-to-fill 法）

const REAL_RECORDS = [
  { date: '2026-05-26', odometer: 33735, liters: 4.72, price_total: 41.25, fuel_type: '92' },
  { date: '2026-06-01', odometer: 33941, liters: 4.35, price_total: 38.01, fuel_type: '92' },
  { date: '2026-06-05', odometer: 34169, liters: 4.37, price_total: 36.35, fuel_type: '92' },
  { date: '2026-06-11', odometer: 34330, liters: 4.35, price_total: 36.19, fuel_type: '92' },
  { date: '2026-06-17', odometer: 34543, liters: 4.16, price_total: 34.61, fuel_type: '92' },
] as const;

describe('真实历史数据集成验证', () => {
  beforeEach(async () => {
    await clearDB(env.DB);
    for (const r of REAL_RECORDS) {
      await insertFuelRecord(env.DB, r);
    }
  });

  it('各区间油耗计算正确（fill-to-fill）', async () => {
    const result = await dispatchTool('query_stats', { mode: 'recent', count: 5 }, env.DB);

    // 06-01：4.72L / 206km * 100 = 2.29
    expect(result).toContain('2.29 L/100km');
    // 06-05：4.35L / 228km * 100 = 1.91
    expect(result).toContain('1.91 L/100km');
    // 06-11：4.37L / 161km * 100 = 2.71
    expect(result).toContain('2.71 L/100km');
    // 06-17：4.35L / 213km * 100 = 2.04
    expect(result).toContain('2.04 L/100km');
  });

  it('综合平均油耗 2.20 L/100km（17.79L / 808km）', async () => {
    const result = await dispatchTool('query_stats', { mode: 'recent', count: 5 }, env.DB);
    expect(result).toContain('平均 2.20 L/100km');
  });

  it('总里程 808km，总花费 ¥185', async () => {
    const result = await dispatchTool('query_stats', { mode: 'recent', count: 5 }, env.DB);
    // totalKm = 206+228+161+213 = 808
    // totalCost = 38.01+36.35+36.19+34.61 = 145.16（record 1 是参考基准，不计入）
    expect(result).toContain('808 km');
  });

  it('date_range 查询 6 月份数据', async () => {
    const result = await dispatchTool('query_stats', {
      mode: 'date_range', start_date: '2026-06-01', end_date: '2026-06-30',
    }, env.DB);
    // 06-01 是区间基准，第一个显示的区间行是 06-05
    expect(result).toContain('2026-06-05');
    expect(result).toContain('📊 油耗统计');
  });

  it('log_fuel 第二条记录显示上次区间油耗', async () => {
    await clearDB(env.DB);
    // 只插入第一条，然后用 log_fuel 插入第二条
    await insertFuelRecord(env.DB, REAL_RECORDS[0]);
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 33941, liters: 4.35, price_total: 38.01, fuel_type: '92',
    }, env.DB);
    // 4.72L / 206km * 100 = 2.29
    expect(result).toContain('2.29 L/100km');
    expect(result).toContain('206 km');
  });

  it('get_last_record 返回最后一条（06-17）', async () => {
    const result = await dispatchTool('get_last_record', {}, env.DB);
    expect(result).toContain('2026-06-17');
    expect(result).toContain('34,543');
    expect(result).toContain('4.16');
  });
});

// ── 加油去重软拦截（spec 017）──────────────────────────────────────────────────

describe('log_fuel dedup (spec 017)', () => {
  it('warns and does NOT write when same day + near-identical odometer', async () => {
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98 });
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 10001, liters: 10, price_total: 98,
    }, env.DB);
    expect(result).toContain('疑似重复');

    // 第二条没有落库（仍只有 1 条最近记录）
    const last = await dispatchTool('get_last_record', {}, env.DB);
    expect(last).toContain('10,000');
  });

  it('confirm=true bypasses dedup and writes', async () => {
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98 });
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 10001, liters: 10, price_total: 98, confirm: true,
    }, env.DB);
    expect(result).toContain('✅ 已记录');
  });

  it('same day but far odometer is not a duplicate', async () => {
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98 });
    const result = await dispatchTool('log_fuel', {
      date: '2026-06-01', odometer: 10200, liters: 10, price_total: 98,
    }, env.DB);
    expect(result).toContain('✅ 已记录');
  });
});

// ── 加油删除二次确认（spec 017）────────────────────────────────────────────────

describe('delete_last_fuel / delete_fuel (spec 017)', () => {
  it('delete_last_fuel two-step: preview then confirm', async () => {
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98 });
    await insertFuelRecord(env.DB, { date: '2026-06-10', odometer: 10200, liters: 9, price_total: 88 });

    const preview = await dispatchTool('delete_last_fuel', {}, env.DB);
    expect(preview).toContain('确定删除');
    // 未删：最近仍是 06-10
    expect(await dispatchTool('get_last_record', {}, env.DB)).toContain('2026-06-10');

    const done = await dispatchTool('delete_last_fuel', { confirm: true }, env.DB);
    expect(done).toContain('🗑 已删除');
    // 删后回退到 06-01
    expect(await dispatchTool('get_last_record', {}, env.DB)).toContain('2026-06-01');
  });

  it('delete_fuel locates an arbitrary record by date and confirms', async () => {
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98 });
    await insertFuelRecord(env.DB, { date: '2026-06-10', odometer: 10200, liters: 9, price_total: 88 });

    const preview = await dispatchTool('delete_fuel', { date: '2026-06-01' }, env.DB);
    expect(preview).toContain('确定删除');

    const done = await dispatchTool('delete_fuel', { date: '2026-06-01', confirm: true }, env.DB);
    expect(done).toContain('🗑 已删除加油记录');
    // 最近一条仍是 06-10（删的是 06-01）
    expect(await dispatchTool('get_last_record', {}, env.DB)).toContain('2026-06-10');
  });

  it('delete_fuel reports not found when nothing matches', async () => {
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 10000, liters: 10, price_total: 98 });
    const result = await dispatchTool('delete_fuel', { date: '2099-01-01' }, env.DB);
    expect(result).toContain('没有找到');
  });
});
