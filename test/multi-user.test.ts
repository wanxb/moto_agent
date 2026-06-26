import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createUser, getUserById, getUserByEmail, getUserByTelegramId, updateUserLastLogin,
  bindTelegramToUser,
  insertFuelRecord, insertMileageRecord, insertMaintenanceRecord, insertReminder,
  getLastFuelRecord, getRecentFuelRecords, getFuelRecordsByDateRange, findFuelRecords,
  getMaintenanceRecords, findMaintenanceRecords, getLatestOdometer,
  insertVehicle, listVehicles, getVehicleByNameOrAlias, getDefaultVehicle, countVehicles,
  getActiveReminders, listRemindersByVehicle, cancelReminders,
} from '../src/database';
import { registry } from '../src/tools';
import { initDB, clearDB } from './utils';

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

// ── 用户 CRUD（spec 016 T2.1）──────────────────────────────────────────────────

describe('user CRUD', () => {
  it('creates and fetches a user by email / telegram_id / id', async () => {
    const id = await createUser(env.DB, { email: 'a@x.com', nickname: 'Alice' });
    const byId = await getUserById(env.DB, id);
    expect(byId!.email).toBe('a@x.com');
    expect(byId!.lang).toBe('zh');           // 默认
    expect(byId!.status).toBe('active');
    expect(byId!.is_admin).toBe(0);

    expect((await getUserByEmail(env.DB, 'a@x.com'))!.id).toBe(id);

    const tgId = await createUser(env.DB, { telegramId: '12345', isAdmin: true, lang: 'en' });
    const tg = await getUserByTelegramId(env.DB, '12345');
    expect(tg!.id).toBe(tgId);
    expect(tg!.is_admin).toBe(1);
    expect(tg!.lang).toBe('en');
  });

  it('updateUserLastLogin sets the timestamp', async () => {
    const id = await createUser(env.DB, { email: 'b@x.com' });
    await updateUserLastLogin(env.DB, id, '2026-06-26T00:00:00Z');
    expect((await getUserById(env.DB, id))!.last_login).toBe('2026-06-26T00:00:00Z');
  });
});

// ── 数据隔离（spec 016 T2.5 / AC7）─────────────────────────────────────────────

describe('data isolation by user_id', () => {
  it('fuel reads scoped to userId never see other users (incl. orphan vehicle_id)', async () => {
    const a = await createUser(env.DB, { email: 'a@x.com' });
    const b = await createUser(env.DB, { email: 'b@x.com' });
    // A 有车记录，B 是孤儿记录（vehicle_id 为空）
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 1000, liters: 5, price_total: 50, vehicle_id: 7, user_id: a });
    await insertFuelRecord(env.DB, { date: '2026-06-02', odometer: 9999, liters: 9, price_total: 90, user_id: b });

    // A 只看到自己的
    expect((await getLastFuelRecord(env.DB, undefined, a))!.odometer).toBe(1000);
    expect((await getRecentFuelRecords(env.DB, 10, undefined, a)).map(r => r.odometer)).toEqual([1000]);
    expect((await getFuelRecordsByDateRange(env.DB, '2026-01-01', '2026-12-31', undefined, a)).map(r => r.odometer)).toEqual([1000]);

    // B 只看到自己的孤儿记录（vehicle_id 为空也按 user_id 隔离）
    expect((await getLastFuelRecord(env.DB, undefined, b))!.odometer).toBe(9999);
    expect((await getRecentFuelRecords(env.DB, 10, undefined, b)).map(r => r.odometer)).toEqual([9999]);

    // 不传 userId → 不过滤（单用户/cron 路径），两条都在
    expect((await getRecentFuelRecords(env.DB, 10)).length).toBe(2);
  });

  it('findFuelRecords honors userId', async () => {
    const a = await createUser(env.DB, { email: 'a@x.com' });
    const b = await createUser(env.DB, { email: 'b@x.com' });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 1000, liters: 5, price_total: 50, user_id: a });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 1000, liters: 5, price_total: 50, user_id: b });
    expect((await findFuelRecords(env.DB, { date: '2026-06-01', userId: a })).length).toBe(1);
    expect((await findFuelRecords(env.DB, { date: '2026-06-01' })).length).toBe(2);  // 无 user → 全部
  });

  it('maintenance reads scoped to userId', async () => {
    const a = await createUser(env.DB, { email: 'a@x.com' });
    const b = await createUser(env.DB, { email: 'b@x.com' });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-01', type: '机油', user_id: a });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-02', type: '轮胎', user_id: b });
    expect((await getMaintenanceRecords(env.DB, { userId: a })).map(m => m.type)).toEqual(['机油']);
    expect((await findMaintenanceRecords(env.DB, { type: '轮胎', userId: a })).length).toBe(0);
    expect((await findMaintenanceRecords(env.DB, { type: '轮胎', userId: b })).length).toBe(1);
  });

  it('getLatestOdometer scoped to userId across fuel + mileage', async () => {
    const a = await createUser(env.DB, { email: 'a@x.com' });
    const b = await createUser(env.DB, { email: 'b@x.com' });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 1000, liters: 5, price_total: 50, user_id: a });
    await insertMileageRecord(env.DB, { date: '2026-06-03', odometer: 1200, user_id: a });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 8000, liters: 5, price_total: 50, user_id: b });
    expect(await getLatestOdometer(env.DB, undefined, a)).toBe(1200);
    expect(await getLatestOdometer(env.DB, undefined, b)).toBe(8000);
  });

  it('vehicle lookups scoped to userId', async () => {
    const a = await createUser(env.DB, { email: 'a@x.com' });
    const b = await createUser(env.DB, { email: 'b@x.com' });
    await insertVehicle(env.DB, '小绿', { isDefault: true, userId: a });
    await insertVehicle(env.DB, '小蓝', { isDefault: true, userId: b });
    expect((await listVehicles(env.DB, a)).map(v => v.name)).toEqual(['小绿']);
    expect(await countVehicles(env.DB, a)).toBe(1);
    expect((await getDefaultVehicle(env.DB, a))!.name).toBe('小绿');
    expect(await getVehicleByNameOrAlias(env.DB, '小蓝', a)).toBeNull();      // A 看不到 B 的车
    expect((await getVehicleByNameOrAlias(env.DB, '小蓝', b))!.name).toBe('小蓝');
  });

  it('reminders: per-user scope vs cron全量', async () => {
    const a = await createUser(env.DB, { email: 'a@x.com' });
    const b = await createUser(env.DB, { email: 'b@x.com' });
    await insertReminder(env.DB, { type: '机油', mode: 'date', trigger_date: '2026-07-01', user_id: a });
    await insertReminder(env.DB, { type: '保险', mode: 'date', trigger_date: '2026-08-01', user_id: b });
    expect((await getActiveReminders(env.DB, a)).map(r => r.type)).toEqual(['机油']);
    expect((await getActiveReminders(env.DB)).length).toBe(2);                 // cron 跨用户
    expect((await listRemindersByVehicle(env.DB, undefined, b)).map(r => r.type)).toEqual(['保险']);
    // 取消只作用于该用户
    expect(await cancelReminders(env.DB, { type: '机油', userId: b })).toBe(0); // B 没有机油提醒
    expect(await cancelReminders(env.DB, { type: '机油', userId: a })).toBe(1);
  });
});

// ── 账号绑定 / 合并（spec 016 T2.2 / AC6 / AC11）───────────────────────────────

describe('bindTelegramToUser', () => {
  it('情形 A — 直接挂载（TG 侧无独立账号）', async () => {
    const e = await createUser(env.DB, { email: 'e@x.com' });
    const res = await bindTelegramToUser(env.DB, 'e@x.com', '999');
    expect(res.merged).toBe(false);
    expect((await getUserById(env.DB, e))!.telegram_id).toBe('999');
    expect((await getUserByTelegramId(env.DB, '999'))!.id).toBe(e);
  });

  it('情形 B — 账号合并（迁移数据 + 旧号失活，AC11）', async () => {
    const e = await createUser(env.DB, { email: 'e@x.com' });           // PWA 账号
    const t = await createUser(env.DB, { telegramId: '999' });          // TG 已有账号
    // TG 侧名下有数据
    await insertVehicle(env.DB, 'TG车', { userId: t });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 500, liters: 5, price_total: 50, user_id: t });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-01', type: '机油', user_id: t });
    await insertReminder(env.DB, { type: '保险', mode: 'date', trigger_date: '2026-09-01', user_id: t });

    const res = await bindTelegramToUser(env.DB, 'e@x.com', '999');
    expect(res.merged).toBe(true);

    // 数据全部改挂到 e
    expect((await listVehicles(env.DB, e)).map(v => v.name)).toEqual(['TG车']);
    expect((await getLastFuelRecord(env.DB, undefined, e))!.odometer).toBe(500);
    expect((await getMaintenanceRecords(env.DB, { userId: e })).length).toBe(1);
    expect((await getActiveReminders(env.DB, e)).length).toBe(1);

    // 旧号失活、腾出 telegram_id；telegram 现在指向 e
    const old = await getUserById(env.DB, t);
    expect(old!.status).toBe('merged');
    expect(old!.telegram_id).toBeNull();
    expect((await getUserByTelegramId(env.DB, '999'))!.id).toBe(e);
  });

  it('幂等 — 重复绑定同账号不报错、不合并', async () => {
    await createUser(env.DB, { email: 'e@x.com' });
    await bindTelegramToUser(env.DB, 'e@x.com', '999');
    const res = await bindTelegramToUser(env.DB, 'e@x.com', '999');
    expect(res.merged).toBe(false);
  });

  it('拒绝 — 邮箱已绑定其他 Telegram', async () => {
    await createUser(env.DB, { email: 'e@x.com', telegramId: '111' });
    await expect(bindTelegramToUser(env.DB, 'e@x.com', '222')).rejects.toThrow();
  });

  it('拒绝 — 邮箱账号不存在', async () => {
    await expect(bindTelegramToUser(env.DB, 'nope@x.com', '999')).rejects.toThrow();
  });
});

// ── 工具层 dispatch 按 userId 隔离（spec 016 T5-A）─────────────────────────────

describe('tool dispatch scopes by userId', () => {
  it('log_fuel 落在 dispatch 的用户名下；读取互不可见', async () => {
    const a = await createUser(env.DB, { email: 'ta@x.com' });
    const b = await createUser(env.DB, { email: 'tb@x.com' });

    // 无车 → 孤儿记录，仅靠 user_id 隔离
    await registry.dispatch('log_fuel', { date: '2026-06-01', odometer: 1000, liters: 5, price_total: 50 }, env.DB, 'zh', a);
    await registry.dispatch('log_fuel', { date: '2026-06-01', odometer: 8000, liters: 8, price_total: 80 }, env.DB, 'zh', b);

    expect((await getLastFuelRecord(env.DB, undefined, a))!.odometer).toBe(1000);
    expect((await getLastFuelRecord(env.DB, undefined, b))!.odometer).toBe(8000);

    // get_last_record 工具经 dispatch 只看到自己
    const aView = await registry.dispatch('get_last_record', {}, env.DB, 'zh', a);
    expect(aView).toContain('1,000');
    expect(aView).not.toContain('8,000');
  });

  it('无 userId 的 dispatch 维持单用户行为（不过滤）', async () => {
    const a = await createUser(env.DB, { email: 'ta@x.com' });
    await registry.dispatch('log_fuel', { date: '2026-06-01', odometer: 1000, liters: 5, price_total: 50 }, env.DB, 'zh', a);
    // 不传 userId → 看得到（历史/单用户路径）
    expect((await getLastFuelRecord(env.DB))!.odometer).toBe(1000);
  });
});
