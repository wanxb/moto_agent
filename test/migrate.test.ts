import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { migrateSingleUser } from '../src/migrate';
import {
  insertVehicle, insertFuelRecord, insertMileageRecord, insertMaintenanceRecord, insertReminder,
  getUserByTelegramId, createUser,
} from '../src/database';
import { initDB, clearDB } from './utils';

beforeAll(async () => { await initDB(env.DB); });
beforeEach(async () => { await clearDB(env.DB); });

const ADMIN = '999999';

async function scalar(sql: string): Promise<number | string | null> {
  const row = await env.DB.prepare(sql).first<Record<string, number | string | null>>();
  return row ? Object.values(row)[0] : null;
}

describe('migrateSingleUser (spec 016 T11)', () => {
  it('回填所有 user_id IS NULL 的数据到管理员，reminders.chat_id 原值保留', async () => {
    // 存量数据，全部 user_id 为空（迁移前的单用户世界）
    const v = await insertVehicle(env.DB, '小绿', { isDefault: true });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 100, liters: 5, price_total: 50, vehicle_id: v });
    await insertMileageRecord(env.DB, { date: '2026-06-02', odometer: 120, vehicle_id: v });
    await insertMaintenanceRecord(env.DB, { date: '2026-06-03', type: '机油' });
    await insertReminder(env.DB, { type: '保险', mode: 'date', trigger_date: '2027-01-01', chat_id: '888' });

    const res = await migrateSingleUser(env.DB, ADMIN);

    // 管理员已建
    const admin = await getUserByTelegramId(env.DB, ADMIN);
    expect(admin!.is_admin).toBe(1);
    expect(res.adminId).toBe(admin!.id);

    // 五张表都已回填
    expect(await scalar('SELECT user_id FROM vehicles')).toBe(admin!.id);
    expect(await scalar('SELECT user_id FROM fuel_records')).toBe(admin!.id);
    expect(await scalar('SELECT user_id FROM mileage_records')).toBe(admin!.id);
    expect(await scalar('SELECT user_id FROM maintenance_records')).toBe(admin!.id);

    // reminders：user_id 填上，chat_id 不动
    const rem = await env.DB.prepare('SELECT chat_id, user_id FROM reminders').first<{ chat_id: string; user_id: number }>();
    expect(rem!.user_id).toBe(admin!.id);
    expect(rem!.chat_id).toBe('888');               // 关键：cron 推送目标原值保留
  });

  it('幂等：重跑不再回填、不重复建管理员', async () => {
    const v = await insertVehicle(env.DB, '小绿', { isDefault: true });
    await insertFuelRecord(env.DB, { date: '2026-06-01', odometer: 100, liters: 5, price_total: 50, vehicle_id: v });

    await migrateSingleUser(env.DB, ADMIN);
    const res2 = await migrateSingleUser(env.DB, ADMIN);

    expect(Object.values(res2.backfilled).every(n => n === 0)).toBe(true);   // 二次全 0
    expect(await scalar(`SELECT COUNT(*) FROM users WHERE telegram_id = '${ADMIN}'`)).toBe(1);  // 不重复
  });

  it('不覆盖已有 user_id 的行', async () => {
    const other = await createUser(env.DB, { email: 'o@x.com' });
    await insertVehicle(env.DB, '别人的车', { userId: other });

    await migrateSingleUser(env.DB, ADMIN);

    expect(await scalar("SELECT user_id FROM vehicles WHERE name = '别人的车'")).toBe(other);  // 未被改
  });
});
