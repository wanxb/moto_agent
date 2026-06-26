import { Bot } from 'grammy';
import { Env, ReminderWithVehicle } from './types';
import type { Lang } from './i18n/types';
import { t } from './i18n';
import { getActiveReminders, getLatestOdometer, markReminderDone, incrementRemindCount, getUserById } from './database';
import { pushPwaNotice } from './routes/chat-api';

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

// 兼容历史签名 formatReminder(r, next) 与新版 formatReminder(r, null, lang, remindCount)。
// remindCount ∈ [1,3] 时附加第N次提醒/剩余次数信息。
export function formatReminder(
  r: DueReminder, nextOdometer?: number | null, lang: Lang = 'zh', remindCount?: number
): string {
  const loc = lang === 'en' ? 'en-US' : 'zh';
  const tag = r.vehicle_name ? t('cron.tag', lang, r.vehicle_name) : '';
  const count = (remindCount != null && remindCount > 0) ? t('cron.remind_count', lang, String(remindCount)) : '';
  if (r.mode === 'mileage') {
    const cur = r.current_odometer != null ? r.current_odometer.toLocaleString(loc) : '—';
    const trig = (r.trigger_odometer ?? 0).toLocaleString(loc);
    return t('cron.mileage_msg', lang, tag, r.type, cur, trig, count);
  }
  return t('cron.date_msg', lang, tag, r.type, r.trigger_date ?? '') + (count ? '\n' + count : '');
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
    const owner = r.user_id != null ? await getUserById(env.DB, r.user_id) : null;
    const lang: Lang = owner?.lang === 'en' ? 'en' : 'zh';
    const text = formatReminder(r, null, lang, r.remind_count + 1);

    const tgTarget = r.chat_id
      ?? owner?.telegram_id
      ?? (r.user_id == null ? env.ALLOWED_CHAT_ID : undefined);

    // 两端同时推，不互斥：TG（有目标时）+ PWA 对话历史（有所属用户时）。
    let pushed = false;

    // ── Telegram ──
    if (tgTarget) {
      try {
        await send(tgTarget, text);
        pushed = true;
      } catch (e) {
        console.error(`[cron] TG push failed for reminder ${r.id}:`, e instanceof Error ? e.message : String(e));
      }
    }

    // ── PWA 对话历史 ──
    if (r.user_id != null) {
      try {
        await pushPwaNotice(env, r.user_id, text);
        pushed = true;
        console.log(`[cron] reminder ${r.id} PWA 通知（user=${r.user_id}）`);
      } catch (e) {
        console.error(`[cron] PWA push failed for reminder ${r.id}:`, e instanceof Error ? e.message : String(e));
      }
    }

    if (!pushed) {
      console.log(`[cron] reminder ${r.id} 无推送通道，跳过`);
      continue;
    }

    // 推送成功后（任一通道即算）：计数+1；满 3 次标记完成。
    await incrementRemindCount(env.DB, r.id);
    if (r.remind_count + 1 >= 3) {
      await markReminderDone(env.DB, r.id, today);
      console.log(`[cron] reminder ${r.id} 第${r.remind_count + 1}次提醒后完成`);
    }
    fired++;
  }

  console.log(`[cron] scanned ${due.length} due, fired ${fired}`);
  return { fired };
}

function defaultSend(env: Env): SendFn {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  return async (chatId, text) => { await bot.api.sendMessage(Number(chatId), text); };
}
