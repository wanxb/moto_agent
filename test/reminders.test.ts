import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { dispatchTool } from '../src/tools';
import {
  insertVehicle, insertFuelRecord, insertMileageRecord,
  insertReminder, getActiveReminders, getLatestOdometer, listRemindersByVehicle,
} from '../src/database';
import { findDueReminders, formatReminder, runScheduled } from '../src/scheduled';
import { initDB, clearDB, makeEnv } from './utils';

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

// ── database: getLatestOdometer ───────────────────────────────────────────────

describe('getLatestOdometer', () => {
  it('takes max across fuel and mileage records, per vehicle', async () => {
    const green = await insertVehicle(env.DB, '小绿', true);
    const commute = await insertVehicle(env.DB, '通勤车', false);
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 12000, liters: 10, price_total: 98, vehicle_id: green });
    await insertMileageRecord(env.DB, { date: '2026-06-05', odometer: 12500, vehicle_id: green });
    await insertFuelRecord(env.DB, { date: '2026-06-02', odometer: 99999, liters: 5, price_total: 40, vehicle_id: commute });

    expect(await getLatestOdometer(env.DB, green)).toBe(12500);     // mileage > fuel
    expect(await getLatestOdometer(env.DB, commute)).toBe(99999);
  });

  it('returns null when no records', async () => {
    expect(await getLatestOdometer(env.DB)).toBeNull();
  });
});

// ── database: reminders CRUD ──────────────────────────────────────────────────

describe('reminders database layer', () => {
  it('insert + getActiveReminders joins vehicle name', async () => {
    const green = await insertVehicle(env.DB, '小绿', true);
    await insertReminder(env.DB, { vehicle_id: green, type: '机油', mode: 'mileage', trigger_odometer: 13000 });
    const active = await getActiveReminders(env.DB);
    expect(active).toHaveLength(1);
    expect(active[0].vehicle_name).toBe('小绿');
    expect(active[0].trigger_odometer).toBe(13000);
  });

  it('listRemindersByVehicle filters by vehicle', async () => {
    const green = await insertVehicle(env.DB, '小绿', true);
    const commute = await insertVehicle(env.DB, '通勤车', false);
    await insertReminder(env.DB, { vehicle_id: green, type: '机油', mode: 'mileage', trigger_odometer: 13000 });
    await insertReminder(env.DB, { vehicle_id: commute, type: '保险', mode: 'date', trigger_date: '2027-01-01' });
    expect(await listRemindersByVehicle(env.DB, green)).toHaveLength(1);
  });
});

// ── tools: set_reminder ───────────────────────────────────────────────────────

describe('set_reminder (tools)', () => {
  it('AC1 — mileage interval uses last maintenance odometer as basis', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    // 上次换机油 10000km
    await dispatchTool('log_maintenance', { date: '2026-05-01', type: '机油', odometer: 10000, vehicle: '小绿' }, env.DB);

    const result = await dispatchTool('set_reminder', { type: '机油', mode: 'mileage', interval_km: 3000 }, env.DB);
    expect(result).toContain('🔔 已设置提醒（小绿）');
    expect(result).toContain('13,000 km');   // 10000 + 3000

    const active = await getActiveReminders(env.DB);
    expect(active[0].trigger_odometer).toBe(13000);
  });

  it('AC1b — mileage interval falls back to latest odometer when no maintenance', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    // 无保养记录，但有加油里程 8000 → 基准取最新里程
    await dispatchTool('log_fuel', { date: '2026-06-01', odometer: 8000, liters: 10, price_total: 98, vehicle: '小绿' }, env.DB);

    const result = await dispatchTool('set_reminder', { type: '机油', mode: 'mileage', interval_km: 3000 }, env.DB);
    expect(result).toContain('11,000 km');   // 8000 + 3000
  });

  it('AC2 — mileage absolute target', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('set_reminder', { type: '机油', mode: 'mileage', trigger_odometer: 13000 }, env.DB);
    expect(result).toContain('13,000 km');
  });

  it('AC3 — date reminder', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('set_reminder', { type: '保险', mode: 'date', trigger_date: '2027-01-05' }, env.DB);
    expect(result).toContain('2027-01-05');
    expect((await getActiveReminders(env.DB))[0].mode).toBe('date');
  });

  it('mileage interval without any basis asks for target', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('set_reminder', { type: '机油', mode: 'mileage', interval_km: 3000 }, env.DB);
    expect(result).toContain('直接给目标里程');
  });

  it('date mode without date asks for it', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('set_reminder', { type: '保险', mode: 'date' }, env.DB);
    expect(result).toContain('到期日期');
  });

  it('setting same type+vehicle replaces the old reminder (no duplicate)', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    await dispatchTool('set_reminder', { type: '机油', mode: 'mileage', trigger_odometer: 13000 }, env.DB);
    // 改成 2000 间隔（绝对目标 15000）
    const result = await dispatchTool('set_reminder', { type: '机油', mode: 'mileage', trigger_odometer: 15000 }, env.DB);
    expect(result).toContain('🔁 已更新提醒');

    const active = await getActiveReminders(env.DB);
    expect(active).toHaveLength(1);            // 不叠加
    expect(active[0].trigger_odometer).toBe(15000);
  });

  it('replacing is scoped per vehicle and per type', async () => {
    const green = await insertVehicle(env.DB, '小绿', true);
    await insertVehicle(env.DB, '通勤车', false);
    await dispatchTool('set_reminder', { type: '机油', mode: 'mileage', trigger_odometer: 13000, vehicle: '小绿' }, env.DB);
    await dispatchTool('set_reminder', { type: '保险', mode: 'date', trigger_date: '2027-01-01', vehicle: '小绿' }, env.DB);
    await dispatchTool('set_reminder', { type: '机油', mode: 'mileage', trigger_odometer: 20000, vehicle: '通勤车' }, env.DB);

    // 替换小绿的机油，不应动小绿的保险或通勤车的机油
    await dispatchTool('set_reminder', { type: '机油', mode: 'mileage', trigger_odometer: 16000, vehicle: '小绿' }, env.DB);
    const active = await getActiveReminders(env.DB);
    expect(active).toHaveLength(3);
    const greenOil = active.find(r => r.vehicle_id === green && r.type === '机油');
    expect(greenOil!.trigger_odometer).toBe(16000);
  });
});

// ── tools: list / cancel ──────────────────────────────────────────────────────

describe('list_reminders / cancel_reminder (tools)', () => {
  it('AC4/AC5 — list then cancel', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    await dispatchTool('set_reminder', { type: '机油', mode: 'mileage', trigger_odometer: 13000 }, env.DB);
    await dispatchTool('set_reminder', { type: '保险', mode: 'date', trigger_date: '2027-01-05' }, env.DB);

    const list = await dispatchTool('list_reminders', {}, env.DB);
    expect(list).toContain('🔔 提醒列表（小绿）');
    expect(list).toContain('机油');
    expect(list).toContain('保险');

    const cancel = await dispatchTool('cancel_reminder', { type: '机油' }, env.DB);
    expect(cancel).toContain('已取消「机油」提醒');
    expect(await getActiveReminders(env.DB)).toHaveLength(1);   // 仅剩保险
  });

  it('cancel non-existent reminder', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    const result = await dispatchTool('cancel_reminder', { type: '机油' }, env.DB);
    expect(result).toContain('没有找到');
  });

  it('empty list message', async () => {
    await dispatchTool('add_vehicle', { name: '小绿' }, env.DB);
    expect(await dispatchTool('list_reminders', {}, env.DB)).toContain('暂无提醒');
  });
});

// ── scheduled: findDueReminders ───────────────────────────────────────────────

describe('findDueReminders', () => {
  it('AC7 — date reminder due when today >= trigger_date', async () => {
    const green = await insertVehicle(env.DB, '小绿', true);
    await insertReminder(env.DB, { vehicle_id: green, type: '保险', mode: 'date', trigger_date: '2026-06-01' });

    expect(await findDueReminders(env.DB, '2026-05-31')).toHaveLength(0);  // 未到
    expect(await findDueReminders(env.DB, '2026-06-01')).toHaveLength(1);  // 到期
  });

  it('AC6/AC9 — mileage reminder due when vehicle latest odometer >= target (per vehicle)', async () => {
    const green = await insertVehicle(env.DB, '小绿', true);
    const commute = await insertVehicle(env.DB, '通勤车', false);
    await insertReminder(env.DB, { vehicle_id: green, type: '机油', mode: 'mileage', trigger_odometer: 13000 });
    // 通勤车里程很高，但不应影响小绿的提醒
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 99999, liters: 5, price_total: 40, vehicle_id: commute });

    expect(await findDueReminders(env.DB, '2026-06-10')).toHaveLength(0);  // 小绿还没里程

    await insertFuelRecord(env.DB, { date: '2026-06-05', odometer: 13050, liters: 10, price_total: 98, vehicle_id: green });
    const due = await findDueReminders(env.DB, '2026-06-10');
    expect(due).toHaveLength(1);
    expect(due[0].current_odometer).toBe(13050);
  });
});

// ── scheduled: runScheduled (push + dedup) ────────────────────────────────────

describe('runScheduled', () => {
  it('AC8 — pushes due reminders once, then dedups on next run', async () => {
    const green = await insertVehicle(env.DB, '小绿', true);
    await insertReminder(env.DB, { vehicle_id: green, type: '机油', mode: 'mileage', trigger_odometer: 13000 });
    await insertFuelRecord(env.DB, { date: '2026-06-05', odometer: 13050, liters: 10, price_total: 98, vehicle_id: green });

    const sent: Array<{ chatId: string; text: string }> = [];
    const send = async (chatId: string, text: string) => { sent.push({ chatId, text }); };
    const e = makeEnv(env.DB, env.SESSION_KV);

    const r1 = await runScheduled(e, { today: '2026-06-10', send });
    expect(r1.fired).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].chatId).toBe('999999');             // ALLOWED_CHAT_ID fallback
    expect(sent[0].text).toContain('🔔 保养提醒（小绿）');
    expect(sent[0].text).toContain('13,000 km');

    // 第二次扫描：已 done，不重发
    const r2 = await runScheduled(e, { today: '2026-06-11', send });
    expect(r2.fired).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('does not mark done when push fails (retryable)', async () => {
    const green = await insertVehicle(env.DB, '小绿', true);
    await insertReminder(env.DB, { vehicle_id: green, type: '保险', mode: 'date', trigger_date: '2026-01-01' });

    const failing = async () => { throw new Error('telegram down'); };
    const e = makeEnv(env.DB, env.SESSION_KV);

    const r = await runScheduled(e, { today: '2026-06-10', send: failing });
    expect(r.fired).toBe(0);
    expect(await getActiveReminders(env.DB)).toHaveLength(1);   // 仍 active，可重试
  });

  it('AC-B1/B2 — mileage reminder with interval auto-renews to next', async () => {
    const green = await insertVehicle(env.DB, '小绿', true);
    await insertReminder(env.DB, { vehicle_id: green, type: '机油', mode: 'mileage', trigger_odometer: 13000, interval_km: 3000 });
    await insertFuelRecord(env.DB, { date: '2026-06-05', odometer: 13050, liters: 10, price_total: 98, vehicle_id: green });

    const sent: Array<{ chatId: string; text: string }> = [];
    const send = async (chatId: string, text: string) => { sent.push({ chatId, text }); };
    const e = makeEnv(env.DB, env.SESSION_KV);

    const r = await runScheduled(e, { today: '2026-06-10', send });
    expect(r.fired).toBe(1);
    expect(sent[0].text).toContain('已自动续期，下次 16,000 km');

    // 旧的 done，新的 active 在 16000
    const active = await getActiveReminders(env.DB);
    expect(active).toHaveLength(1);
    expect(active[0].trigger_odometer).toBe(16000);
    expect(active[0].interval_km).toBe(3000);
  });

  it('AC-B3 — absolute mileage reminder (no interval) does NOT renew', async () => {
    const green = await insertVehicle(env.DB, '小绿', true);
    await insertReminder(env.DB, { vehicle_id: green, type: '机油', mode: 'mileage', trigger_odometer: 13000 });
    await insertFuelRecord(env.DB, { date: '2026-06-05', odometer: 13050, liters: 10, price_total: 98, vehicle_id: green });

    const e = makeEnv(env.DB, env.SESSION_KV);
    await runScheduled(e, { today: '2026-06-10', send: async () => {} });
    expect(await getActiveReminders(env.DB)).toHaveLength(0);   // 一次性，无续期
  });
});

// ── formatReminder ────────────────────────────────────────────────────────────

describe('formatReminder', () => {
  it('mileage and date formats', () => {
    const mileage = formatReminder({
      id: 1, vehicle_id: 1, type: '机油', mode: 'mileage', trigger_odometer: 13000,
      trigger_date: null, interval_km: null, note: null, chat_id: null, status: 'active', fired_at: null,
      created_at: '', vehicle_name: '小绿', current_odometer: 13050,
    });
    expect(mileage).toContain('该处理「机油」了');
    expect(mileage).toContain('13,050');

    // 带续期：附加下次里程
    const renewed = formatReminder({
      id: 1, vehicle_id: 1, type: '机油', mode: 'mileage', trigger_odometer: 13000,
      trigger_date: null, interval_km: 3000, note: null, chat_id: null, status: 'active', fired_at: null,
      created_at: '', vehicle_name: '小绿', current_odometer: 13050,
    }, 16000);
    expect(renewed).toContain('已自动续期，下次 16,000 km');

    const date = formatReminder({
      id: 2, vehicle_id: null, type: '保险', mode: 'date', trigger_odometer: null,
      trigger_date: '2027-01-05', interval_km: null, note: null, chat_id: null, status: 'active', fired_at: null,
      created_at: '', vehicle_name: null,
    });
    expect(date).toContain('保险 到期：2027-01-05');
  });
});
