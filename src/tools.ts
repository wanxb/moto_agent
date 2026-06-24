import { ToolDefinition, Vehicle } from './types';
import {
  insertFuelRecord, insertMileageRecord,
  getLastFuelRecord, getRecentFuelRecords, getFuelRecordsByDateRange,
  insertVehicle, getVehicleByName, listVehicles, getDefaultVehicle, setDefaultVehicle,
} from './database';

export const TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'log_fuel',
      description: '记录一次加油。用户提供加油信息时调用。',
      parameters: {
        type: 'object',
        properties: {
          date:        { type: 'string', description: 'ISO 8601 日期如 2026-06-23，默认今天' },
          odometer:    { type: 'number', description: '当前里程表读数（km）' },
          liters:      { type: 'number', description: '加油量（升）' },
          price_total: { type: 'number', description: '总价（元）' },
          fuel_type:   { type: 'string', enum: ['92', '95', '98'], description: '油品标号，默认 95' },
          note:        { type: 'string', description: '备注（可选）' },
          vehicle:     { type: 'string', description: '车辆名称（可选）。用户提到车名时传入；未提到则不传，记到默认车。' },
        },
        required: ['date', 'odometer', 'liters', 'price_total'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_mileage',
      description: '记录纯里程（未加油的骑行），用于补全区间距离。',
      parameters: {
        type: 'object',
        properties: {
          date:     { type: 'string', description: 'ISO 8601 日期' },
          odometer: { type: 'number', description: '当前里程表读数（km）' },
          note:     { type: 'string', description: '备注（可选）' },
          vehicle:  { type: 'string', description: '车辆名称（可选），未传则记到默认车。' },
        },
        required: ['date', 'odometer'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_stats',
      description: '查询油耗统计，支持最近 N 次或日期范围两种模式。',
      parameters: {
        type: 'object',
        properties: {
          mode:       { type: 'string', enum: ['recent', 'date_range'], description: '查询模式' },
          count:      { type: 'number', description: '最近 N 次（mode=recent）' },
          start_date: { type: 'string', description: '开始日期（mode=date_range）' },
          end_date:   { type: 'string', description: '结束日期（mode=date_range）' },
          vehicle:    { type: 'string', description: '车辆名称（可选），未传则查默认车。' },
        },
        required: ['mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_last_record',
      description: '获取最近一条加油记录。',
      parameters: {
        type: 'object',
        properties: {
          vehicle: { type: 'string', description: '车辆名称（可选），未传则取默认车。' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_vehicle',
      description: '添加一辆车。用户说"添加车""新增一辆车 xxx"时调用。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '车辆名称，如"小绿"' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_vehicles',
      description: '列出全部车辆。用户问"我有哪些车"时调用。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_default_vehicle',
      description: '设置默认车。用户说"默认车设成 xxx""切换到 xxx"时调用。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '要设为默认的车辆名称' },
        },
        required: ['name'],
      },
    },
  },
];

export async function dispatchTool(
  name: string, input: Record<string, unknown>, db: D1Database
): Promise<string> {
  switch (name) {
    case 'log_fuel':            return logFuel(input, db);
    case 'log_mileage':         return logMileage(input, db);
    case 'query_stats':         return queryStats(input, db);
    case 'get_last_record':     return getLastRecord(input, db);
    case 'add_vehicle':         return addVehicle(input, db);
    case 'list_vehicles':       return listVehiclesTool(db);
    case 'set_default_vehicle': return setDefaultVehicleTool(input, db);
    default:                    return `未知工具：${name}`;
  }
}

// ── Vehicle resolution ────────────────────────────────────────────────────────
// 把用户说的车名解析成具体车辆。无车辆时返回 'none'（按单车/历史模式处理，不强制建车）。

type VehicleResolution =
  | { status: 'resolved'; vehicle: Vehicle }
  | { status: 'not_found'; name: string }
  | { status: 'ambiguous'; vehicles: Vehicle[] }
  | { status: 'none' };

async function resolveVehicle(db: D1Database, name?: string): Promise<VehicleResolution> {
  if (name) {
    const v = await getVehicleByName(db, name);
    return v ? { status: 'resolved', vehicle: v } : { status: 'not_found', name };
  }
  const def = await getDefaultVehicle(db);
  if (def) return { status: 'resolved', vehicle: def };

  const all = await listVehicles(db);
  if (all.length === 0) return { status: 'none' };
  if (all.length === 1) return { status: 'resolved', vehicle: all[0] };
  return { status: 'ambiguous', vehicles: all };
}

function ambiguousMsg(vehicles: Vehicle[], verb: string): string {
  return `请指明${verb}哪辆车（你有：${vehicles.map(v => v.name).join('、')}）。`;
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function logFuel(input: Record<string, unknown>, db: D1Database): Promise<string> {
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

async function logMileage(input: Record<string, unknown>, db: D1Database): Promise<string> {
  const { date, odometer, note, vehicle } = input as {
    date: string; odometer: number; note?: string; vehicle?: string;
  };

  const r = await resolveVehicle(db, vehicle);
  if (r.status === 'not_found') return `没有找到车辆「${r.name}」，可以先说"添加一辆车 ${r.name}"。`;
  if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '记到');

  const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
  const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

  await insertMileageRecord(db, { date, odometer, note, vehicle_id: vehicleId });
  return `✅ 里程已记录${vehicleName ? `（${vehicleName}）` : ''}：${odometer.toLocaleString('zh')} km（${date}）`;
}

async function queryStats(input: Record<string, unknown>, db: D1Database): Promise<string> {
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

async function getLastRecord(input: Record<string, unknown>, db: D1Database): Promise<string> {
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

// ── Vehicle management tools ──────────────────────────────────────────────────

async function addVehicle(input: Record<string, unknown>, db: D1Database): Promise<string> {
  const { name } = input as { name: string };

  const existing = await getVehicleByName(db, name);
  if (existing) return `车辆「${name}」已存在。`;

  // 首辆车自动设为默认
  const isFirst = (await listVehicles(db)).length === 0;
  await insertVehicle(db, name, isFirst);

  return isFirst
    ? `✅ 已添加车辆「${name}」，已设为默认车。`
    : `✅ 已添加车辆「${name}」。`;
}

async function listVehiclesTool(db: D1Database): Promise<string> {
  const vehicles = await listVehicles(db);
  if (vehicles.length === 0) return '还没有车辆，可以说"添加一辆车 小绿"。';
  const lines = vehicles.map(v => `• ${v.name}${v.is_default ? '（默认）' : ''}`);
  return ['🏍 车辆列表', ...lines].join('\n');
}

async function setDefaultVehicleTool(input: Record<string, unknown>, db: D1Database): Promise<string> {
  const { name } = input as { name: string };
  const v = await getVehicleByName(db, name);
  if (!v) return `没有找到车辆「${name}」。`;
  await setDefaultVehicle(db, v.id);
  return `✅ 已将默认车设为「${name}」。`;
}
