// 加油记录相关工具（spec 001–004）。
// 每个工具 = 类实现 Tool 接口，由 ToolRegistry.register() 收集。

import type { Tool } from './interface';
import { resolveVehicle, ambiguousMsg } from './_helpers';
import {
  insertFuelRecord, getLastFuelRecord, getRecentFuelRecords, getFuelRecordsByDateRange,
  updateFuelRecord, softDeleteFuelRecord,
} from '../database';

// ── log_fuel ──────────────────────────────────────────────────────────────────

export class LogFuelTool implements Tool {
  readonly name = 'log_fuel';
  readonly description = '记录一次加油。用户提供加油信息时调用。';
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

  async execute(input: Record<string, unknown>, db: D1Database): Promise<string> {
    const { date, odometer, liters, price_total, fuel_type, note, vehicle } = input as {
      date: string; odometer: number; liters: number; price_total: number;
      fuel_type?: string; note?: string; vehicle?: string;
    };

    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return `没有找到车辆「${r.name}」，可以先说"添加一辆车 ${r.name}"。`;
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '记到');

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    const prev = await getLastFuelRecord(db, vehicleId);
    await insertFuelRecord(db, { date, odometer, liters, price_total, fuel_type, note, vehicle_id: vehicleId });

    const pricePerL = (price_total / liters).toFixed(2);
    let msg = `✅ 已记录${vehicleName ? `（${vehicleName}）` : ''}\n📍 里程：${odometer.toLocaleString('zh')} km\n⛽ 加油：${liters} L × ¥${pricePerL}/L = ¥${price_total}`;

    if (prev) {
      const distance = odometer - prev.odometer;
      if (distance > 0) {
        const consumption = (prev.liters / distance * 100).toFixed(2);
        msg += `\n📊 本次油耗：${consumption} L/100km（距上次 ${distance} km）`;
      }
    } else {
      msg += '\n📊 首次记录，下次加油后将显示油耗';
    }
    return msg;
  }
}

// ── query_stats ───────────────────────────────────────────────────────────────

export class QueryStatsTool implements Tool {
  readonly name = 'query_stats';
  readonly description = '查询油耗统计，支持最近 N 次或日期范围两种模式。';
  readonly parameters = {
    mode:       { type: 'string', enum: ['recent', 'date_range'], description: '查询模式' },
    count:      { type: 'number', description: '最近 N 次（mode=recent）' },
    start_date: { type: 'string', description: '开始日期（mode=date_range）' },
    end_date:   { type: 'string', description: '结束日期（mode=date_range）' },
    vehicle:    { type: 'string', description: '车辆名称（可选），未传则查默认车。' },
  } as const;
  readonly required = ['mode'];

  async execute(input: Record<string, unknown>, db: D1Database): Promise<string> {
    const { mode, count, start_date, end_date, vehicle } = input as {
      mode: 'recent' | 'date_range'; count?: number; start_date?: string; end_date?: string; vehicle?: string;
    };

    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return `没有找到车辆「${r.name}」。`;
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '查询');

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    const records = mode === 'recent'
      ? (await getRecentFuelRecords(db, (count ?? 5) + 1, vehicleId)).reverse()
      : await getFuelRecordsByDateRange(db, start_date!, end_date!, vehicleId);

    if (records.length === 0) return '暂无加油记录。';
    if (records.length === 1) return '只有 1 条记录，需要至少 2 条才能计算区间油耗。';

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

    if (lines.length === 0) return '数据异常，无法计算。';

    const avg = (totalLiters / totalKm * 100).toFixed(2);
    return [
      vehicleName ? `📊 ${vehicleName} · 油耗统计` : '📊 油耗统计',
      '─'.repeat(32),
      ...lines,
      '─'.repeat(32),
      `平均 ${avg} L/100km`,
      `总计 ¥${totalCost.toFixed(0)} / ${totalKm} km`,
    ].join('\n');
  }
}

// ── get_last_record ───────────────────────────────────────────────────────────

export class GetLastRecordTool implements Tool {
  readonly name = 'get_last_record';
  readonly description = '仅查询「最近/上次加油」记录的详情（如"上次什么时候加的油""最近一次加油多少钱""最近油耗多少"）。注意：设提醒用 set_reminder、改记录用 update_last_fuel、保养用 maintenance 工具，不要拿此工具替代它们。';
  readonly parameters = {
    vehicle: { type: 'string', description: '车辆名称（可选），未传则取默认车。' },
  } as const;
  readonly required: string[] = [];

  async execute(input: Record<string, unknown>, db: D1Database): Promise<string> {
    const { vehicle } = input as { vehicle?: string };

    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return `没有找到车辆「${r.name}」。`;
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '查询');

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    const rec = await getLastFuelRecord(db, vehicleId);
    if (!rec) return '暂无加油记录。';
    const pricePerL = (rec.price_total / rec.liters).toFixed(2);
    return [
      `🕐 最近一次加油${vehicleName ? `（${vehicleName}）` : ''}`,
      `日期：${rec.date}`,
      `里程：${rec.odometer.toLocaleString('zh')} km`,
      `加油：${rec.liters} L，¥${rec.price_total}（¥${pricePerL}/L）`,
      `油品：${rec.fuel_type}号`,
    ].join('\n');
  }
}

// ── update_last_fuel (spec 004) ───────────────────────────────────────────────

export class UpdateLastFuelTool implements Tool {
  readonly name = 'update_last_fuel';
  readonly description = '修改最近一条加油记录。用户说"上一条里程改成X""上次写错了，是9升"等纠错时调用，只传要改的字段。';
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

  async execute(input: Record<string, unknown>, db: D1Database): Promise<string> {
    const { date, odometer, liters, price_total, fuel_type, note, vehicle } = input as {
      date?: string; odometer?: number; liters?: number; price_total?: number;
      fuel_type?: string; note?: string; vehicle?: string;
    };

    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return `没有找到车辆「${r.name}」。`;
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '修改');

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    const last = await getLastFuelRecord(db, vehicleId);
    if (!last) return '没有可修改的加油记录。';

    const fields = { date, odometer, liters, price_total, fuel_type, note };
    const changed = await updateFuelRecord(db, last.id, fields);
    if (changed === 0) return '请说明要修改什么（里程、升数、价格、油品或日期）。';

    const m = { ...last, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) } as typeof last;
    const pricePerL = (m.price_total / m.liters).toFixed(2);
    return [
      `✏️ 已修改最近一条加油记录${vehicleName ? `（${vehicleName}）` : ''}`,
      `📍 里程：${m.odometer.toLocaleString('zh')} km`,
      `⛽ ${m.liters} L × ¥${pricePerL}/L = ¥${m.price_total}`,
      `📅 ${m.date} · ${m.fuel_type}号`,
    ].join('\n');
  }
}

// ── delete_last_fuel (spec 004) ───────────────────────────────────────────────

export class DeleteLastFuelTool implements Tool {
  readonly name = 'delete_last_fuel';
  readonly description = '删除最近一条加油记录。用户说"删掉刚才那条""删除最近记录"时调用。';
  readonly parameters = {
    vehicle: { type: 'string', description: '车辆名称（可选），未传则删默认车的最近记录。' },
  } as const;
  readonly required: string[] = [];

  async execute(input: Record<string, unknown>, db: D1Database): Promise<string> {
    const { vehicle } = input as { vehicle?: string };

    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return `没有找到车辆「${r.name}」。`;
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '删除');

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    const last = await getLastFuelRecord(db, vehicleId);
    if (!last) return '没有可删除的加油记录。';

    await softDeleteFuelRecord(db, last.id, new Date().toISOString());
    return [
      `🗑 已删除最近一条加油记录${vehicleName ? `（${vehicleName}）` : ''}`,
      `${last.date} · ${last.odometer.toLocaleString('zh')} km · ${last.liters} L · ¥${last.price_total}`,
      '（如需恢复请联系管理员）',
    ].join('\n');
  }
}
