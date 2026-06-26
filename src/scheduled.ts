import { Bot } from 'grammy';
import { Env, ReminderWithVehicle } from './types';
import type { Lang } from './i18n/types';
import { t } from './i18n';
import { getActiveReminders, getLatestOdometer, markReminderDone, insertReminder, getUserById } from './database';

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
// lang 放最后一个参数（默认 zh）以兼容历史位置调用 formatReminder(r, next)。
export function formatReminder(r: DueReminder, nextOdometer: number | null = null, lang: Lang = 'zh'): string {
  const loc = lang === 'en' ? 'en-US' : 'zh';
  const tag = r.vehicle_name ? t('cron.tag', lang, r.vehicle_name) : '';
  if (r.mode === 'mileage') {
    const cur = r.current_odometer != null ? r.current_odometer.toLocaleString(loc) : '—';
    const trig = (r.trigger_odometer ?? 0).toLocaleString(loc);
    const renew = nextOdometer != null ? t('cron.renew', lang, nextOdometer.toLocaleString(loc)) : '';
    return t('cron.mileage_msg', lang, tag, r.type, cur, trig, renew);
  }
  return t('cron.date_msg', lang, tag, r.type, r.trigger_date ?? '');
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
    // 属主：决定推送语言 + telegram_id 回退（spec 016 T10B）
    const owner = r.user_id != null ? await getUserById(env.DB, r.user_id) : null;
    const lang: Lang = owner?.lang === 'en' ? 'en' : 'zh';
    // 推送目标：reminders.chat_id → 属主 users.telegram_id → （仅无属主的历史提醒）ALLOWED_CHAT_ID。
    // 关键：有属主的提醒绝不回退到 ALLOWED_CHAT_ID，否则会把别人的提醒推给管理员。
    // 纯 PWA 属主（有 user_id 但未绑 TG、且无 chat_id）→ 无目标，跳过（Phase 4 再加站内/邮件提醒）。
    const target = r.chat_id
      ?? owner?.telegram_id
      ?? (r.user_id == null ? env.ALLOWED_CHAT_ID : undefined);
    if (!target) {
      console.log(`[cron] reminder ${r.id} 无推送目标（纯 PWA 未绑 TG），跳过`);
      continue;
    }
    try {
      // 里程提醒带间隔 → 自动续期到下一个里程（spec 006）
      const next = (r.mode === 'mileage' && r.interval_km != null && r.trigger_odometer != null)
        ? r.trigger_odometer + r.interval_km
        : null;

      await send(target, formatReminder(r, next, lang));
      // 仅推送成功后才标记完成，失败下次重试（不丢提醒）
      await markReminderDone(env.DB, r.id, today);
      if (next != null) {
        await insertReminder(env.DB, {
          vehicle_id: r.vehicle_id, type: r.type, mode: 'mileage',
          trigger_odometer: next, interval_km: r.interval_km, note: r.note,
          chat_id: r.chat_id, user_id: r.user_id,   // 续期记录继承归属（chat_id + user_id）
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
