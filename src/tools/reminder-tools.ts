// 定时提醒工具（spec 003/006/007/010）。

import type { Tool } from './interface';
import type { Lang } from '../i18n/types';
import { t, fmtNumber } from '../i18n';
import { resolveVehicle, ambiguousMsg } from './_helpers';
import {
  insertReminder, listRemindersByVehicle, cancelReminders, getLatestOdometer,
} from '../database';
import { getLastMaintenanceByType } from '../database';

// ── set_reminder ──────────────────────────────────────────────────────────────

export class SetReminderTool implements Tool {
  readonly name = 'set_reminder';
  readonly description = '设置定时提醒。检测到"提醒"二字就务必用此工具，不要用查询工具。里程类："每N公里提醒X"/"换X每N公里"/"X每N公里提醒我"→mode=mileage+interval_km；"到N公里提醒X"→trigger_odometer。日期类："保险Y日到期提醒"→mode=date+trigger_date。';
  readonly descriptionEn = 'Set a reminder. Mileage-based: use mode=mileage with interval_km or trigger_odometer. Date-based: use mode=date with trigger_date.';
  readonly parameters = {
    type:             { type: 'string', description: '提醒类型/标签，如 机油/保险/年检' },
    mode:             { type: 'string', enum: ['mileage', 'date'], description: '里程模式或日期模式' },
    interval_km:      { type: 'number', description: '里程模式：间隔公里数' },
    trigger_odometer: { type: 'number', description: '里程模式：目标里程' },
    trigger_date:     { type: 'string', description: '日期模式：ISO 日期，如 2027-01-05' },
    note:             { type: 'string', description: '备注（可选）' },
    vehicle:          { type: 'string', description: '车辆名称（可选）' },
  } as const;
  readonly required = ['type', 'mode'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang, userId?: number): Promise<string> {
    const { type, mode, interval_km, trigger_odometer, trigger_date, note, vehicle } = input as {
      type: string; mode: 'mileage' | 'date';
      interval_km?: number; trigger_odometer?: number; trigger_date?: string;
      note?: string; vehicle?: string;
    };
    const r = await resolveVehicle(db, vehicle, userId);
    if (r.status === 'not_found') return t('general.vehicle_not_found_add', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.set', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;
    const tag = vehicleName ? t('fuel.vehicle_tag', lang, vehicleName) : '';

    if (mode === 'mileage') {
      let target = trigger_odometer ?? null;
      let basisNote = '';
      const intervalToStore = (trigger_odometer == null && interval_km != null) ? interval_km : null;
      if (target == null) {
        if (interval_km == null) return t('reminder.mileage_need', lang);
        const lastMaint = await getLastMaintenanceByType(db, type, vehicleId, userId);
        const basis = lastMaint?.odometer ?? await getLatestOdometer(db, vehicleId, userId);
        if (basis == null) return t('reminder.no_basis', lang);
        target = basis + interval_km;
        basisNote = t('reminder.basis_note', lang, fmtNumber(basis, lang), String(interval_km));
      }
      const replaced = await cancelReminders(db, { type, vehicleId, userId });
      await insertReminder(db, { vehicle_id: vehicleId, type, mode: 'mileage', trigger_odometer: target, interval_km: intervalToStore, note, user_id: userId });
      const renewNote = intervalToStore != null ? t('reminder.renew_note', lang, String(intervalToStore)) : '';
      const prefix = t(replaced > 0 ? 'reminder.updated_prefix' : 'reminder.set_prefix', lang, tag);
      return t('reminder.mileage_set', lang, prefix, type, fmtNumber(target, lang), basisNote, renewNote);
    }

    // date mode
    if (!trigger_date) return t('reminder.date_need', lang);
    const replaced = await cancelReminders(db, { type, vehicleId });
    await insertReminder(db, { vehicle_id: vehicleId, type, mode: 'date', trigger_date, note, user_id: userId });
    const prefix = t(replaced > 0 ? 'reminder.updated_prefix' : 'reminder.set_prefix', lang, tag);
    return t('reminder.date_set', lang, prefix, type, trigger_date);
  }
}

// ── list_reminders ────────────────────────────────────────────────────────────

export class ListRemindersTool implements Tool {
  readonly name = 'list_reminders';
  readonly description = '列出当前活跃的提醒。用户问"我设了哪些提醒"时调用。';
  readonly descriptionEn = 'List all active reminders.';
  readonly parameters = {
    vehicle: { type: 'string', description: '车辆名称（可选）' },
  } as const;
  readonly required: string[] = [];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang, userId?: number): Promise<string> {
    const { vehicle } = input as { vehicle?: string };
    const r = await resolveVehicle(db, vehicle, userId);
    if (r.status === 'not_found') return t('general.vehicle_not_found', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.query', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    const reminders = await listRemindersByVehicle(db, vehicleId, userId);
    const tag = vehicleName ? t('fuel.vehicle_tag', lang, vehicleName) : '';
    if (reminders.length === 0) return t('reminder.list_empty', lang, tag);

    const lines = reminders.map(rm => {
      const cond = rm.mode === 'mileage'
        ? `${fmtNumber(rm.trigger_odometer ?? 0, lang)} km`
        : rm.trigger_date ?? '';
      return `• ${rm.type} · ${cond}`;
    });
    const title = t('reminder.list_title', lang, tag);
    return [title, ...lines].join('\n');
  }
}

// ── cancel_reminder ───────────────────────────────────────────────────────────

export class CancelReminderTool implements Tool {
  readonly name = 'cancel_reminder';
  readonly description = '取消提醒。用户说"取消 X 提醒"时调用，传 type=X。';
  readonly descriptionEn = 'Cancel a reminder by type.';
  readonly parameters = {
    type:    { type: 'string', description: '要取消的提醒类型' },
    vehicle: { type: 'string', description: '车辆名称（可选）' },
  } as const;
  readonly required = ['type'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang, userId?: number): Promise<string> {
    const { type, vehicle } = input as { type: string; vehicle?: string };
    const r = await resolveVehicle(db, vehicle, userId);
    if (r.status === 'not_found') return t('general.vehicle_not_found', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.cancel', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const count = await cancelReminders(db, { type, vehicleId, userId });
    return count > 0
      ? t('reminder.cancelled', lang, type, String(count))
      : t('reminder.cancel_not_found', lang, type);
  }
}
