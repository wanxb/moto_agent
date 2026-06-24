// 定时提醒工具（spec 003/006/007）。

import type { Tool } from './interface';
import { resolveVehicle, ambiguousMsg } from './_helpers';
import {
  insertReminder, listRemindersByVehicle, cancelReminders, getLatestOdometer,
} from '../database';
import { getLastMaintenanceByType } from '../database';

// ── set_reminder ──────────────────────────────────────────────────────────────

export class SetReminderTool implements Tool {
  readonly name = 'set_reminder';
  readonly description = '设置定时提醒。检测到"提醒"二字就务必用此工具，不要用查询工具。里程类："每N公里提醒X"/"换X每N公里"/"X每N公里提醒我"→mode=mileage+interval_km；"到N公里提醒X"→trigger_odometer。日期类："保险Y日到期提醒"→mode=date+trigger_date。设提醒才是提醒，查记录不是提醒。';
  readonly parameters = {
    type:             { type: 'string', description: '提醒类型/标签，如 机油/保险/年检' },
    mode:             { type: 'string', enum: ['mileage', 'date'], description: '里程模式或日期模式' },
    interval_km:      { type: 'number', description: '里程模式：间隔公里数（如每 3000 公里），从上次同类保养或当前里程起算' },
    trigger_odometer: { type: 'number', description: '里程模式：直接指定目标里程（与 interval_km 二选一）' },
    trigger_date:     { type: 'string', description: '日期模式：ISO 日期，如 2027-01-05' },
    note:             { type: 'string', description: '备注（可选）' },
    vehicle:          { type: 'string', description: '车辆名称（可选），未传则用默认车。' },
  } as const;
  readonly required = ['type', 'mode'];

  async execute(input: Record<string, unknown>, db: D1Database): Promise<string> {
    const { type, mode, interval_km, trigger_odometer, trigger_date, note, vehicle } = input as {
      type: string; mode: 'mileage' | 'date';
      interval_km?: number; trigger_odometer?: number; trigger_date?: string;
      note?: string; vehicle?: string;
    };
    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return `没有找到车辆「${r.name}」，可以先说"添加一辆车 ${r.name}"。`;
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '设到');

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;
    const tag = vehicleName ? `（${vehicleName}）` : '';

    if (mode === 'mileage') {
      let target = trigger_odometer ?? null;
      let basisNote = '';
      const intervalToStore = (trigger_odometer == null && interval_km != null) ? interval_km : null;
      if (target == null) {
        if (interval_km == null) return '里程提醒需要给"间隔公里数"或"目标里程"其中之一。';
        const lastMaint = await getLastMaintenanceByType(db, type, vehicleId);
        const basis = lastMaint?.odometer ?? await getLatestOdometer(db, vehicleId);
        if (basis == null) return '还没有里程或保养记录作基准，请先记录里程，或直接给目标里程（如"机油到 13000 提醒"）。';
        target = basis + interval_km;
        basisNote = `（上次 ${basis.toLocaleString('zh')} km + ${interval_km}）`;
      }
      const replaced = await cancelReminders(db, { type, vehicleId });
      await insertReminder(db, { vehicle_id: vehicleId, type, mode: 'mileage', trigger_odometer: target, interval_km: intervalToStore, note });
      const renewNote = intervalToStore != null ? `\n（每 ${intervalToStore} km 自动续期）` : '';
      return `${replaced > 0 ? '🔁 已更新提醒' : '🔔 已设置提醒'}${tag}\n${type} · 里程达到 ${target.toLocaleString('zh')} km 时提醒${basisNote}${renewNote}`;
    }

    // date mode
    if (!trigger_date) return '日期提醒需要给一个到期日期（如 2027-01-05）。';
    const replaced = await cancelReminders(db, { type, vehicleId });
    await insertReminder(db, { vehicle_id: vehicleId, type, mode: 'date', trigger_date, note });
    return `${replaced > 0 ? '🔁 已更新提醒' : '🔔 已设置提醒'}${tag}\n${type} · ${trigger_date} 到期时提醒`;
  }
}

// ── list_reminders ────────────────────────────────────────────────────────────

export class ListRemindersTool implements Tool {
  readonly name = 'list_reminders';
  readonly description = '列出当前活跃的提醒。用户问"我设了哪些提醒"时调用。';
  readonly parameters = {
    vehicle: { type: 'string', description: '车辆名称（可选），未传则列默认车。' },
  } as const;
  readonly required: string[] = [];

  async execute(input: Record<string, unknown>, db: D1Database): Promise<string> {
    const { vehicle } = input as { vehicle?: string };
    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return `没有找到车辆「${r.name}」。`;
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '查询');

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    const reminders = await listRemindersByVehicle(db, vehicleId);
    if (reminders.length === 0) return `暂无提醒${vehicleName ? `（${vehicleName}）` : ''}。`;

    const lines = reminders.map(rm => {
      const cond = rm.mode === 'mileage'
        ? `${(rm.trigger_odometer ?? 0).toLocaleString('zh')} km`
        : rm.trigger_date ?? '';
      return `• ${rm.type} · ${cond}`;
    });
    return [`🔔 提醒列表${vehicleName ? `（${vehicleName}）` : ''}`, ...lines].join('\n');
  }
}

// ── cancel_reminder ───────────────────────────────────────────────────────────

export class CancelReminderTool implements Tool {
  readonly name = 'cancel_reminder';
  readonly description = '取消提醒。用户说"取消 X 提醒"时调用，传 type=X。';
  readonly parameters = {
    type:    { type: 'string', description: '要取消的提醒类型，如 机油' },
    vehicle: { type: 'string', description: '车辆名称（可选），未传则用默认车。' },
  } as const;
  readonly required = ['type'];

  async execute(input: Record<string, unknown>, db: D1Database): Promise<string> {
    const { type, vehicle } = input as { type: string; vehicle?: string };
    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return `没有找到车辆「${r.name}」。`;
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '取消');

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const count = await cancelReminders(db, { type, vehicleId });
    return count > 0 ? `✅ 已取消「${type}」提醒（${count} 条）。` : `没有找到活跃的「${type}」提醒。`;
  }
}
