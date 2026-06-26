// 维保记录工具（spec 002/010）。

import type { Tool } from './interface';
import type { Lang } from '../i18n/types';
import { t } from '../i18n';
import { resolveVehicle, ambiguousMsg, fmtKm, fmtCost, validateDateNotFuture } from './_helpers';
import {
  insertMaintenanceRecord, getMaintenanceRecords, getLastMaintenanceByType,
  findMaintenanceRecords, softDeleteMaintenanceRecord,
} from '../database';
import { MAINT_DUP_DAYS } from '../config';

/** 两个 ISO 日期相差的天数（绝对值）；无法解析时返回 Infinity（视为不重复）。 */
function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / 86_400_000;
}

// ── log_maintenance ───────────────────────────────────────────────────────────

export class LogMaintenanceTool implements Tool {
  readonly name = 'log_maintenance';
  readonly description = '记录一次维修保养或相关支出（换机油/轮胎/刹车/链条、交保险、年检等）。凡是"交了保险X""买了保险""换了X""做了X保养""花X做了X"都要调用它记录下来，里程或费用没说就不传。不要只回复确认而不记录。';
  readonly descriptionEn = 'Record a maintenance event (oil change, tire, brake, chain, insurance, inspection, etc.).';
  readonly parameters = {
    date:     { type: 'string', description: 'ISO 8601 日期，默认今天' },
    type:     { type: 'string', description: '保养类型，如 机油/轮胎/保险/刹车/链条/其他' },
    odometer: { type: 'number', description: '当前里程（km，可选）' },
    cost:     { type: 'number', description: '费用（元，可选）' },
    note:     { type: 'string', description: '备注（可选）' },
    vehicle:  { type: 'string', description: '车辆名称（可选），未传则记到默认车。' },
    confirm:  { type: 'boolean', description: '仅当工具上一轮提示"疑似重复"且用户明确确认后才传 true，用于跳过去重检查。正常记录不要传。' },
  } as const;
  readonly required = ['date', 'type'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang, userId?: number): Promise<string> {
    const { date, type, odometer, cost, note, vehicle, confirm } = input as {
      date: string; type: string; odometer?: number; cost?: number; note?: string; vehicle?: string; confirm?: boolean;
    };
    const r = await resolveVehicle(db, vehicle, userId);
    if (r.status === 'not_found') return t('general.vehicle_not_found_add', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.record', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    // 未来日期拦截：不允许录入明天及以后的记录
    const dateErr = validateDateNotFuture(date, lang);
    if (dateErr) return dateErr;

    // spec 017: 写入前去重软拦截——同车同类型且日期相近视为疑似重复，未确认则先反问不落库
    if (confirm !== true) {
      const sameType = await findMaintenanceRecords(db, { vehicleId, type, userId });
      const dup = sameType.find(rec => daysBetween(rec.date, date) <= MAINT_DUP_DAYS);
      if (dup) {
        return t('dup.maint_warn', lang, type, dup.date);
      }
    }

    await insertMaintenanceRecord(db, { date, type, odometer: odometer ?? null, cost: cost ?? null, note, vehicle_id: vehicleId, user_id: userId });
    const parts = [type, fmtKm(odometer ?? null, lang), fmtCost(cost ?? null, lang), date];
    const tag = vehicleName ? t('fuel.vehicle_tag', lang, vehicleName) : '';
    return t('maint.recorded', lang, tag) + '\n' + t('maint.parts', lang, parts.join(' · '));
  }
}

// ── query_maintenance ─────────────────────────────────────────────────────────

export class QueryMaintenanceTool implements Tool {
  readonly name = 'query_maintenance';
  readonly description = '查询保养记录。问"保养记录"列历史；问"上次换 X"传 type=X 且 last_only=true。';
  readonly descriptionEn = 'Query maintenance records. Use type=X and last_only=true for "when did I last change X?".';
  readonly parameters = {
    type:      { type: 'string', description: '按类型过滤，如 机油（可选）' },
    last_only: { type: 'boolean', description: '仅返回最近一次' },
    vehicle:   { type: 'string', description: '车辆名称（可选）' },
  } as const;
  readonly required: string[] = [];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang, userId?: number): Promise<string> {
    const { type, last_only, vehicle } = input as {
      type?: string; last_only?: boolean; vehicle?: string;
    };
    const r = await resolveVehicle(db, vehicle, userId);
    if (r.status === 'not_found') return t('general.vehicle_not_found', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.query', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;
    const tag = vehicleName ? t('fuel.vehicle_tag', lang, vehicleName) : '';

    if (last_only && type) {
      const last = await getLastMaintenanceByType(db, type, vehicleId, userId);
      if (!last) return t('maint.no_records', lang, type, tag);
      return [t('maint.last_title', lang, type, tag), `${last.date} · ${fmtKm(last.odometer, lang)} · ${fmtCost(last.cost, lang)}`].join('\n');
    }

    const records = await getMaintenanceRecords(db, { vehicleId, type, userId });
    if (records.length === 0) {
      return t('maint.no_records', lang, type || '', tag);
    }
    const lines = records.map(m => `${m.date}  ${m.type}  ${fmtKm(m.odometer, lang)}  ${fmtCost(m.cost, lang)}`);
    const title = vehicleName
      ? t('maint.list_title_vehicle', lang, vehicleName, type || t('maint.records_word', lang))
      : (type ? t('maint.list_title', lang, type) : t('maint.list_title_default', lang));
    return [title, '─'.repeat(32), ...lines].join('\n');
  }
}

// ── delete_maintenance (spec 017) ─────────────────────────────────────────────

// 维保记录单行摘要（删除预览/列表复用）。
function maintLine(m: { date: string; type: string; odometer: number | null; cost: number | null; note: string | null }, lang: Lang): string {
  const base = `${m.date} · ${m.type} · ${fmtKm(m.odometer, lang)} · ${fmtCost(m.cost, lang)}`;
  return m.note ? `${base} · ${m.note}` : base;
}

export class DeleteMaintenanceTool implements Tool {
  readonly name = 'delete_maintenance';
  readonly description = '删除一条保养记录（按类型/日期定位）。两步：先不带 confirm 取预览，用户确认后再带 confirm=true。多条同类型重复想"只留一条"时传 keep_one=true（保留最早一条，删其余）。';
  readonly descriptionEn = 'Delete a maintenance record (located by type/date). Two-step confirm. To dedupe several identical records keeping the earliest, pass keep_one=true.';
  readonly parameters = {
    type:     { type: 'string', description: '保养类型，如 机油/轮胎（定位用，可选）' },
    date:     { type: 'string', description: '记录日期（ISO 8601，定位用，可选）' },
    vehicle:  { type: 'string', description: '车辆名称（可选），未传则在默认车内定位。' },
    keep_one: { type: 'boolean', description: '多条重复时只保留最早一条、删除其余。用户说"删掉重复的只留一条"时传 true。' },
    confirm:  { type: 'boolean', description: '用户在预览后明确确认才传 true，执行删除；否则不传。' },
  } as const;
  readonly required: string[] = [];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang, userId?: number): Promise<string> {
    const { type, date, vehicle, keep_one, confirm } = input as {
      type?: string; date?: string; vehicle?: string; keep_one?: boolean; confirm?: boolean;
    };

    const r = await resolveVehicle(db, vehicle, userId);
    if (r.status === 'not_found') return t('general.vehicle_not_found', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.delete', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;
    const tag = vehicleName ? t('fuel.vehicle_tag', lang, vehicleName) : '';

    // 升序定位（最早在前），便于 keep_one 保留最早一条
    const matches = await findMaintenanceRecords(db, { vehicleId, type, date, userId });
    if (matches.length === 0) return t('delete.maint_not_found', lang);

    // 多条重复去重：保留最早一条，软删其余
    if (matches.length > 1 && keep_one) {
      const toDelete = matches.slice(1);
      if (confirm !== true) {
        return t('delete.maint_keep_one_confirm', lang,
          String(matches.length), tag, String(toDelete.length),
          toDelete.map(m => maintLine(m, lang)).join('\n'));
      }
      const now = new Date().toISOString();
      for (const m of toDelete) await softDeleteMaintenanceRecord(db, m.id, now);
      return t('delete.maint_kept_one', lang, String(toDelete.length), tag) + '\n' + t('delete.recover_hint', lang);
    }

    // 多条但未指明 keep_one：列出让用户缩小范围，不猜
    if (matches.length > 1) {
      return t('delete.maint_multi', lang, matches.map(m => maintLine(m, lang)).join('\n'));
    }

    // 唯一匹配：预览 → 确认 → 软删
    const target = matches[0];
    if (confirm !== true) {
      return t('delete.maint_confirm', lang, tag, maintLine(target, lang));
    }
    await softDeleteMaintenanceRecord(db, target.id, new Date().toISOString());
    return [t('delete.maint_done', lang, tag), maintLine(target, lang), t('delete.recover_hint', lang)].join('\n');
  }
}
