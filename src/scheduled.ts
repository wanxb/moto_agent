import { Bot } from 'grammy';
import { Env, ReminderWithVehicle } from './types';
import { getActiveReminders, getLatestOdometer, markReminderDone, insertReminder } from './database';

export interface DueReminder extends ReminderWithVehicle {
  current_odometer?: number;   // mileage 模式：判定时的当前里程
}

// 纯判定：扫描活跃提醒，返回已到期的。today 注入便于测试；里程经 DB 查询。
export async function findDueReminders(db: D1Database, today: string): Promise<DueReminder[]> {
  const active = await getActiveReminders(db);
  const due: DueReminder[] = [];

  for (const r of active) {
    if (r.mode === 'date') {
      if (r.trigger_date && r.trigger_date <= today) due.push(r);
    } else if (r.mode === 'mileage' && r.trigger_odometer != null) {
      const odo = await getLatestOdometer(db, r.vehicle_id ?? undefined);
      if (odo != null && odo >= r.trigger_odometer) due.push({ ...r, current_odometer: odo });
    }
  }
  return due;
}

// nextOdometer 非空时表示自动续期，附加下次里程提示（spec 006）。
export function formatReminder(r: DueReminder, nextOdometer: number | null = null): string {
  const tag = r.vehicle_name ? `（${r.vehicle_name}）` : '';
  if (r.mode === 'mileage') {
    const cur = r.current_odometer != null ? `${r.current_odometer.toLocaleString('zh')} km` : '—';
    const trig = (r.trigger_odometer ?? 0).toLocaleString('zh');
    const renew = nextOdometer != null ? `\n已自动续期，下次 ${nextOdometer.toLocaleString('zh')} km 提醒` : '';
    return `🔔 保养提醒${tag}\n该处理「${r.type}」了：当前 ${cur} ≥ 提醒里程 ${trig} km${renew}`;
  }
  return `🔔 提醒${tag}\n${r.type} 到期：${r.trigger_date}`;
}

type SendFn = (chatId: string, text: string) => Promise<void>;

// 副作用：推送到期提醒并去重。send/today 可注入便于测试。
export async function runScheduled(
  env: Env,
  opts: { today?: string; send?: SendFn } = {}
): Promise<{ fired: number }> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const send: SendFn = opts.send ?? defaultSend(env);

  const due = await findDueReminders(env.DB, today);
  let fired = 0;

  for (const r of due) {
    const target = r.chat_id ?? env.ALLOWED_CHAT_ID;
    if (!target) {
      console.error(`[cron] reminder ${r.id} has no push target, skipped`);
      continue;
    }
    try {
      // 里程提醒带间隔 → 自动续期到下一个里程（spec 006）
      const next = (r.mode === 'mileage' && r.interval_km != null && r.trigger_odometer != null)
        ? r.trigger_odometer + r.interval_km
        : null;

      await send(target, formatReminder(r, next));
      // 仅推送成功后才标记完成，失败下次重试（不丢提醒）
      await markReminderDone(env.DB, r.id, today);
      if (next != null) {
        await insertReminder(env.DB, {
          vehicle_id: r.vehicle_id, type: r.type, mode: 'mileage',
          trigger_odometer: next, interval_km: r.interval_km, note: r.note, chat_id: r.chat_id,
        });
      }
      fired++;
    } catch (e) {
      console.error(`[cron] push failed for reminder ${r.id}:`, e instanceof Error ? e.message : String(e));
    }
  }

  console.log(`[cron] scanned ${due.length} due, fired ${fired}`);
  return { fired };
}

function defaultSend(env: Env): SendFn {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  return async (chatId, text) => { await bot.api.sendMessage(Number(chatId), text); };
}
