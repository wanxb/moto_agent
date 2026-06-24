// 维保记录工具（spec 002）。

import type { Tool } from './interface';
import { resolveVehicle, ambiguousMsg, fmtKm, fmtCost } from './_helpers';
import {
  insertMaintenanceRecord, getMaintenanceRecords, getLastMaintenanceByType,
} from '../database';

// ── log_maintenance ───────────────────────────────────────────────────────────

export class LogMaintenanceTool implements Tool {
  readonly name = 'log_maintenance';
  readonly description = '记录一次维修保养或相关支出（换机油/轮胎/刹车/链条、交保险、年检等）。凡是"交了保险X""买了保险""换了X""做了X保养""花X做了X"都要调用它记录下来，里程或费用没说就不传。不要只回复确认而不记录。';
  readonly parameters = {
    date:     { type: 'string', description: 'ISO 8601 日期，默认今天' },
    type:     { type: 'string', description: '保养类型，如 机油/轮胎/保险/刹车/链条/其他（常见值优先，可自由文本）' },
    odometer: { type: 'number', description: '当前里程（km，可选；保险等无里程则不传）' },
    cost:     { type: 'number', description: '费用（元，可选）' },
    note:     { type: 'string', description: '备注（可选）' },
    vehicle:  { type: 'string', description: '车辆名称（可选），未传则记到默认车。' },
  } as const;
  readonly required = ['date', 'type'];

  async execute(input: Record<string, unknown>, db: D1Database): Promise<string> {
    const { date, type, odometer, cost, note, vehicle } = input as {
      date: string; type: string; odometer?: number; cost?: number; note?: string; vehicle?: string;
    };
    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return `没有找到车辆「${r.name}」，可以先说"添加一辆车 ${r.name}"。`;
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '记到');

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    await insertMaintenanceRecord(db, { date, type, odometer: odometer ?? null, cost: cost ?? null, note, vehicle_id: vehicleId });
    const parts = [type, fmtKm(odometer ?? null), fmtCost(cost ?? null), date];
    return `✅ 已记录保养${vehicleName ? `（${vehicleName}）` : ''}\n🔧 ${parts.join(' · ')}`;
  }
}

// ── query_maintenance ─────────────────────────────────────────────────────────

export class QueryMaintenanceTool implements Tool {
  readonly name = 'query_maintenance';
  readonly description = '查询保养记录。问"保养记录"列历史；问"上次换 X"传 type=X 且 last_only=true。';
  readonly parameters = {
    type:      { type: 'string', description: '按类型过滤，如 机油（可选）' },
    last_only: { type: 'boolean', description: '仅返回最近一次（用于"上次换 X"）' },
    vehicle:   { type: 'string', description: '车辆名称（可选），未传则查默认车。' },
  } as const;
  readonly required: string[] = [];

  async execute(input: Record<string, unknown>, db: D1Database): Promise<string> {
    const { type, last_only, vehicle } = input as {
      type?: string; last_only?: boolean; vehicle?: string;
    };
    const r = await resolveVehicle(db, vehicle);
    if (r.status === 'not_found') return `没有找到车辆「${r.name}」。`;
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '查询');

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;
    const tag = vehicleName ? `（${vehicleName}）` : '';

    // "上次换 X"：仅最近一条
    if (last_only && type) {
      const last = await getLastMaintenanceByType(db, type, vehicleId);
      if (!last) return `暂无「${type}」保养记录${tag}。`;
      return [`🔧 最近一次「${type}」${tag}`, `${last.date} · ${fmtKm(last.odometer)} · ${fmtCost(last.cost)}`].join('\n');
    }

    const records = await getMaintenanceRecords(db, { vehicleId, type });
    if (records.length === 0) {
      return `暂无${type ? `「${type}」` : ''}保养记录${tag}。`;
    }
    const lines = records.map(m => `${m.date}  ${m.type}  ${fmtKm(m.odometer)}  ${fmtCost(m.cost)}`);
    return [`🔧 ${vehicleName ? `${vehicleName} · ` : ''}保养记录${type ? `（${type}）` : ''}`, '─'.repeat(32), ...lines].join('\n');
  }
}
