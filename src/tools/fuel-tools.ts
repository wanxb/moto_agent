// 加油记录相关工具（spec 001–004/010/011）。
// 每个工具 = 类实现 Tool 接口，由 ToolRegistry.register() 收集。

import type { Tool } from './interface';
import type { Lang } from '../i18n/types';
import { t, fmtNumber, fmtPricePerL } from '../i18n';
import { resolveVehicle, ambiguousMsg, fmtKm, fmtCost } from './_helpers';
import {
  insertFuelRecord, getLastFuelRecord, getRecentFuelRecords, getFuelRecordsByDateRange,
  updateFuelRecord, softDeleteFuelRecord,
  getVehicleMostUsedFuelType, updateVehicle,
} from '../database';

// ── log_fuel ──────────────────────────────────────────────────────────────────

export class LogFuelTool implements Tool {
  readonly name = 'log_fuel';
  readonly description = '记录一次加油。用户提供加油信息时调用。';
  readonly descriptionEn = 'Record a fuel-up. Call when the user provides fuel-up details.';
  readonly parameters = {
    date:        { type: 'string', description: 'ISO 8601 日期如 2026-06-23，默认今天' },
    odometer:    { type: 'number', description: '当前里程表读数（km）' },
    liters:      { type: 'number', description: '加油量（升）' },
    price_total: { type: 'number', description: '总价（元）' },
    fuel_type:   { type: 'string', enum: ['92', '95', '98'], description: '油品标号，默认 95' },
    note:        { type: 'string', description: '备注（可选）' },
    vehicle:     { type: 'string', description: '车辆名称（可选）。用户提到车名时传入；未提到则不传，记到默认车。' },
  } as const;
  readonly required = ['date', 'odometer', 'liters', 'price_total'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    let { date, odometer, liters, price_total, fuel_type, note, vehicle } = input as {
      date: string; odometer: number; liters: number; price_total: number;
      fuel_type?: string; note?: string; vehicle?: string;
    };

    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return t('general.vehicle_not_found_add', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.record', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    // spec 011: 未提油号时，用车辆默认油号；车辆无默认则 fallback 到 95
    if (!fuel_type && r.status === 'resolved' && r.vehicle.fuel_type) {
      fuel_type = r.vehicle.fuel_type;
    }

    const prev = await getLastFuelRecord(db, vehicleId);
    await insertFuelRecord(db, { date, odometer, liters, price_total, fuel_type, note, vehicle_id: vehicleId });

    // spec 011: 自动检测油号变化
    if (r.status === 'resolved') {
      const mostUsed = await getVehicleMostUsedFuelType(db, r.vehicle.id);
      if (mostUsed && mostUsed.count >= 3 && r.vehicle.fuel_type !== mostUsed.fuel_type) {
        await updateVehicle(db, r.vehicle.id, { fuel_type: mostUsed.fuel_type });
        console.log(`[tool] auto-updated ${r.vehicle.name} fuel_type: ${r.vehicle.fuel_type ?? 'null'} → ${mostUsed.fuel_type}`);
      }
    }

    const tag = vehicleName ? t('fuel.vehicle_tag', lang, vehicleName) : '';
    const pricePerL = (price_total / liters).toFixed(2);
    let msg = t('fuel.recorded', lang, tag) + '\n'
      + t('fuel.odometer', lang, fmtNumber(odometer, lang)) + '\n'
      + t('fuel.fueling', lang, String(liters), pricePerL, fmtNumber(price_total, lang));

    if (prev) {
      const distance = odometer - prev.odometer;
      if (distance > 0) {
        const consumption = (prev.liters / distance * 100).toFixed(2);
        msg += '\n' + t('fuel.consumption', lang, consumption, fmtNumber(distance, lang));
      }
    } else {
      msg += '\n' + t('fuel.first_record', lang);
    }
    return msg;
  }
}

// ── query_stats ───────────────────────────────────────────────────────────────

export class QueryStatsTool implements Tool {
  readonly name = 'query_stats';
  readonly description = '查询油耗统计，支持最近 N 次或日期范围两种模式。';
  readonly descriptionEn = 'Query fuel consumption statistics. Supports recent N records or date range.';
  readonly parameters = {
    mode:       { type: 'string', enum: ['recent', 'date_range'], description: '查询模式' },
    count:      { type: 'number', description: '最近 N 次（mode=recent）' },
    start_date: { type: 'string', description: '开始日期（mode=date_range）' },
    end_date:   { type: 'string', description: '结束日期（mode=date_range）' },
    vehicle:    { type: 'string', description: '车辆名称（可选），未传则查默认车。' },
  } as const;
  readonly required = ['mode'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const { mode, count, start_date, end_date, vehicle } = input as {
      mode: 'recent' | 'date_range'; count?: number; start_date?: string; end_date?: string; vehicle?: string;
    };

    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return t('general.vehicle_not_found', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.query', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    const records = mode === 'recent'
      ? (await getRecentFuelRecords(db, (count ?? 5) + 1, vehicleId)).reverse()
      : await getFuelRecordsByDateRange(db, start_date!, end_date!, vehicleId);

    if (records.length === 0) return t('general.no_fuel_records', lang);
    if (records.length === 1) return t('fuel.only_one', lang);

    const lines: string[] = [];
    let totalCost = 0, totalKm = 0, totalLiters = 0;

    for (let i = 1; i < records.length; i++) {
      const cur = records[i], prev = records[i - 1];
      const km = cur.odometer - prev.odometer;
      if (km <= 0) continue;
      const consumption = (prev.liters / km * 100).toFixed(2);
      lines.push(`${cur.date}  ${consumption} L/100km  ${km}km  ¥${cur.price_total}`);
      totalCost += cur.price_total;
      totalKm += km;
      totalLiters += prev.liters;
    }

    if (lines.length === 0) return t('fuel.data_abnormal', lang);

    const avg = (totalLiters / totalKm * 100).toFixed(2);
    const title = vehicleName
      ? (lang === 'en' ? `📊 ${vehicleName} · Fuel Statistics` : `📊 ${vehicleName} · 油耗统计`)
      : t('fuel.stats_title_default', lang);
    return [
      title,
      '─'.repeat(32),
      ...lines,
      '─'.repeat(32),
      t('fuel.avg', lang, avg),
      t('fuel.total', lang, totalCost.toFixed(0), String(totalKm)),
    ].join('\n');
  }
}

// ── get_last_record ───────────────────────────────────────────────────────────

export class GetLastRecordTool implements Tool {
  readonly name = 'get_last_record';
  readonly description = '仅查询「最近/上次加油」记录的详情（如"上次什么时候加的油""最近一次加油多少钱""最近油耗多少"）。注意：设提醒用 set_reminder、改记录用 update_last_fuel、保养用 maintenance 工具，不要拿此工具替代它们。';
  readonly descriptionEn = 'Query the most recent fuel-up record details. Do NOT use this for setting reminders, editing records, or maintenance — use the dedicated tools for those.';
  readonly parameters = {
    vehicle: { type: 'string', description: '车辆名称（可选），未传则取默认车。' },
  } as const;
  readonly required: string[] = [];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const { vehicle } = input as { vehicle?: string };

    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return t('general.vehicle_not_found', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.query', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    const rec = await getLastFuelRecord(db, vehicleId);
    if (!rec) return t('general.no_fuel_records', lang);
    const pricePerL = (rec.price_total / rec.liters).toFixed(2);
    const tag = vehicleName ? t('fuel.vehicle_tag', lang, vehicleName) : '';
    return [
      t('fuel.last_title', lang, tag),
      t('fuel.last_date', lang, rec.date),
      t('fuel.last_odometer', lang, fmtNumber(rec.odometer, lang)),
      t('fuel.last_detail', lang, String(rec.liters), fmtNumber(rec.price_total, lang), pricePerL),
      t('fuel.last_fuel_type', lang, rec.fuel_type),
    ].join('\n');
  }
}

// ── update_last_fuel (spec 004) ───────────────────────────────────────────────

export class UpdateLastFuelTool implements Tool {
  readonly name = 'update_last_fuel';
  readonly description = '修改最近一条加油记录。用户说"上一条里程改成X""上次写错了，是9升"等纠错时调用，只传要改的字段。';
  readonly descriptionEn = 'Edit the most recent fuel record. Call when the user wants to correct a previous entry.';
  readonly parameters = {
    date:        { type: 'string', description: '改为该日期（ISO 8601）' },
    odometer:    { type: 'number', description: '改为该里程（km）' },
    liters:      { type: 'number', description: '改为该加油量（升）' },
    price_total: { type: 'number', description: '改为该总价（元）' },
    fuel_type:   { type: 'string', enum: ['92', '95', '98'], description: '改为该油品' },
    note:        { type: 'string', description: '改为该备注' },
    vehicle:     { type: 'string', description: '车辆名称（可选），未传则改默认车的最近记录。' },
  } as const;
  readonly required: string[] = [];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const { date, odometer, liters, price_total, fuel_type, note, vehicle } = input as {
      date?: string; odometer?: number; liters?: number; price_total?: number;
      fuel_type?: string; note?: string; vehicle?: string;
    };

    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return t('general.vehicle_not_found', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.edit', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    const last = await getLastFuelRecord(db, vehicleId);
    if (!last) return t('general.no_fuel_records_edit', lang);

    const fields = { date, odometer, liters, price_total, fuel_type, note };
    const changed = await updateFuelRecord(db, last.id, fields);
    if (changed === 0) return t('fuel.need_fields', lang);

    const m = { ...last, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) } as typeof last;
    const pricePerL = (m.price_total / m.liters).toFixed(2);
    const tag = vehicleName ? t('fuel.vehicle_tag', lang, vehicleName) : '';
    return t('fuel.edited', lang, tag) + '\n' +
      t('fuel.edit_summary', lang, fmtNumber(m.odometer, lang), String(m.liters), pricePerL, fmtNumber(m.price_total, lang), m.date, m.fuel_type);
  }
}

// ── delete_last_fuel (spec 004) ───────────────────────────────────────────────

export class DeleteLastFuelTool implements Tool {
  readonly name = 'delete_last_fuel';
  readonly description = '删除最近一条加油记录。用户说"删掉刚才那条""删除最近记录"时调用。';
  readonly descriptionEn = 'Delete the most recent fuel record. Call when the user wants to undo a fuel entry.';
  readonly parameters = {
    vehicle: { type: 'string', description: '车辆名称（可选），未传则删默认车的最近记录。' },
  } as const;
  readonly required: string[] = [];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const { vehicle } = input as { vehicle?: string };

    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return t('general.vehicle_not_found', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.delete', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    const last = await getLastFuelRecord(db, vehicleId);
    if (!last) return t('general.no_fuel_records_delete', lang);

    await softDeleteFuelRecord(db, last.id, new Date().toISOString());
    const tag = vehicleName ? t('fuel.vehicle_tag', lang, vehicleName) : '';
    return [
      t('fuel.deleted', lang, tag),
      `${last.date} · ${fmtNumber(last.odometer, lang)} km · ${last.liters} L · ¥${fmtNumber(last.price_total, lang)}`,
      t('fuel.deleted_detail', lang),
    ].join('\n');
  }
}
