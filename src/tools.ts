import { ToolDefinition, Vehicle } from './types';
import {
  insertFuelRecord, insertMileageRecord,
  getLastFuelRecord, getRecentFuelRecords, getFuelRecordsByDateRange,
  insertVehicle, getVehicleByName, listVehicles, getDefaultVehicle, setDefaultVehicle, renameVehicle,
  insertMaintenanceRecord, getMaintenanceRecords, getLastMaintenanceByType,
  insertReminder, listRemindersByVehicle, cancelReminders, getLatestOdometer,
  updateFuelRecord, softDeleteFuelRecord,
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
  {
    type: 'function',
    function: {
      name: 'rename_vehicle',
      description: '给已有车辆改名。用户说"把X改名叫Y""X改成Y"时调用。',
      parameters: {
        type: 'object',
        properties: {
          name:     { type: 'string', description: '车辆当前名称' },
          new_name: { type: 'string', description: '新名称' },
        },
        required: ['name', 'new_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_maintenance',
      description: '记录一次维修保养（换机油/轮胎/保险/刹车/链条等）。用户描述保养时调用。',
      parameters: {
        type: 'object',
        properties: {
          date:     { type: 'string', description: 'ISO 8601 日期，默认今天' },
          type:     { type: 'string', description: '保养类型，如 机油/轮胎/保险/刹车/链条/其他（常见值优先，可自由文本）' },
          odometer: { type: 'number', description: '当前里程（km，可选；保险等无里程则不传）' },
          cost:     { type: 'number', description: '费用（元，可选）' },
          note:     { type: 'string', description: '备注（可选）' },
          vehicle:  { type: 'string', description: '车辆名称（可选），未传则记到默认车。' },
        },
        required: ['date', 'type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_maintenance',
      description: '查询保养记录。问"保养记录"列历史；问"上次换 X"传 type=X 且 last_only=true。',
      parameters: {
        type: 'object',
        properties: {
          type:      { type: 'string', description: '按类型过滤，如 机油（可选）' },
          last_only: { type: 'boolean', description: '仅返回最近一次（用于"上次换 X"）' },
          vehicle:   { type: 'string', description: '车辆名称（可选），未传则查默认车。' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_reminder',
      description: '设置提醒。里程类（如"机油每3000公里"/"机油到13000提醒"）或日期类（如"保险X日到期"）。',
      parameters: {
        type: 'object',
        properties: {
          type:             { type: 'string', description: '提醒类型/标签，如 机油/保险/年检' },
          mode:             { type: 'string', enum: ['mileage', 'date'], description: '里程模式或日期模式' },
          interval_km:      { type: 'number', description: '里程模式：间隔公里数（如每 3000 公里），从上次同类保养或当前里程起算' },
          trigger_odometer: { type: 'number', description: '里程模式：直接指定目标里程（与 interval_km 二选一）' },
          trigger_date:     { type: 'string', description: '日期模式：ISO 日期，如 2027-01-05' },
          note:             { type: 'string', description: '备注（可选）' },
          vehicle:          { type: 'string', description: '车辆名称（可选），未传则用默认车。' },
        },
        required: ['type', 'mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description: '列出当前活跃的提醒。用户问"我设了哪些提醒"时调用。',
      parameters: {
        type: 'object',
        properties: {
          vehicle: { type: 'string', description: '车辆名称（可选），未传则列默认车。' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_reminder',
      description: '取消提醒。用户说"取消 X 提醒"时调用，传 type=X。',
      parameters: {
        type: 'object',
        properties: {
          type:    { type: 'string', description: '要取消的提醒类型，如 机油' },
          vehicle: { type: 'string', description: '车辆名称（可选），未传则用默认车。' },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_last_fuel',
      description: '修改最近一条加油记录。用户说"上一条里程改成X""上次写错了，是9升"等纠错时调用，只传要改的字段。',
      parameters: {
        type: 'object',
        properties: {
          date:        { type: 'string', description: '改为该日期（ISO 8601）' },
          odometer:    { type: 'number', description: '改为该里程（km）' },
          liters:      { type: 'number', description: '改为该加油量（升）' },
          price_total: { type: 'number', description: '改为该总价（元）' },
          fuel_type:   { type: 'string', enum: ['92', '95', '98'], description: '改为该油品' },
          note:        { type: 'string', description: '改为该备注' },
          vehicle:     { type: 'string', description: '车辆名称（可选），未传则改默认车的最近记录。' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_last_fuel',
      description: '删除最近一条加油记录。用户说"删掉刚才那条""删除最近记录"时调用。',
      parameters: {
        type: 'object',
        properties: {
          vehicle: { type: 'string', description: '车辆名称（可选），未传则删默认车的最近记录。' },
        },
        required: [],
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
    case 'rename_vehicle':      return renameVehicleTool(input, db);
    case 'log_maintenance':     return logMaintenance(input, db);
    case 'query_maintenance':   return queryMaintenance(input, db);
    case 'set_reminder':        return setReminder(input, db);
    case 'list_reminders':      return listRemindersTool(input, db);
    case 'cancel_reminder':     return cancelReminderTool(input, db);
    case 'update_last_fuel':    return updateLastFuel(input, db);
    case 'delete_last_fuel':    return deleteLastFuel(input, db);
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

async function renameVehicleTool(input: Record<string, unknown>, db: D1Database): Promise<string> {
  const { name, new_name } = input as { name: string; new_name: string };
  if (name === new_name) return `新旧名称相同，无需修改。`;

  const v = await getVehicleByName(db, name);
  if (!v) return `没有找到车辆「${name}」。`;

  const clash = await getVehicleByName(db, new_name);
  if (clash) return `已存在车辆「${new_name}」，换个名字吧。`;

  await renameVehicle(db, v.id, new_name);
  return `✅ 已将车辆「${name}」改名为「${new_name}」。`;
}

// ── Maintenance tools (spec 002) ──────────────────────────────────────────────

function fmtKm(odometer: number | null): string {
  return odometer == null ? '—' : `${odometer.toLocaleString('zh')} km`;
}
function fmtCost(cost: number | null): string {
  return cost == null ? '—' : `¥${cost}`;
}

async function logMaintenance(input: Record<string, unknown>, db: D1Database): Promise<string> {
  const { date, type, odometer, cost, note, vehicle } = input as {
    date: string; type: string; odometer?: number; cost?: number; note?: string; vehicle?: string;
  };

  const r = await resolveVehicle(db, vehicle);
  if (r.status === 'not_found') return `没有找到车辆「${r.name}」，可以先说"添加一辆车 ${r.name}"。`;
  if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '记到');

  const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
  const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

  await insertMaintenanceRecord(db, {
    date, type, odometer: odometer ?? null, cost: cost ?? null, note, vehicle_id: vehicleId,
  });

  const parts = [type, fmtKm(odometer ?? null), fmtCost(cost ?? null), date];
  return `✅ 已记录保养${vehicleName ? `（${vehicleName}）` : ''}\n🔧 ${parts.join(' · ')}`;
}

async function queryMaintenance(input: Record<string, unknown>, db: D1Database): Promise<string> {
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
    return [
      `🔧 最近一次「${type}」${tag}`,
      `${last.date} · ${fmtKm(last.odometer)} · ${fmtCost(last.cost)}`,
    ].join('\n');
  }

  const records = await getMaintenanceRecords(db, { vehicleId, type });
  if (records.length === 0) {
    return `暂无${type ? `「${type}」` : ''}保养记录${tag}。`;
  }

  const lines = records.map(m => `${m.date}  ${m.type}  ${fmtKm(m.odometer)}  ${fmtCost(m.cost)}`);
  return [
    `🔧 ${vehicleName ? `${vehicleName} · ` : ''}保养记录${type ? `（${type}）` : ''}`,
    '─'.repeat(32),
    ...lines,
  ].join('\n');
}

// ── Reminder tools (spec 003) ─────────────────────────────────────────────────

async function setReminder(input: Record<string, unknown>, db: D1Database): Promise<string> {
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
    // 仅"间隔"模式存 interval_km → 触发后自动续期；绝对目标不存 → 一次性（spec 006）
    const intervalToStore = (trigger_odometer == null && interval_km != null) ? interval_km : null;
    if (target == null) {
      if (interval_km == null) return '里程提醒需要给"间隔公里数"或"目标里程"其中之一。';
      // 基准：上次同类保养里程 → 否则当前最新里程
      const lastMaint = await getLastMaintenanceByType(db, type, vehicleId);
      const basis = lastMaint?.odometer ?? await getLatestOdometer(db, vehicleId);
      if (basis == null) return '还没有里程或保养记录作基准，请先记录里程，或直接给目标里程（如"机油到 13000 提醒"）。';
      target = basis + interval_km;
      basisNote = `（上次 ${basis.toLocaleString('zh')} km + ${interval_km}）`;
    }
    await insertReminder(db, { vehicle_id: vehicleId, type, mode: 'mileage', trigger_odometer: target, interval_km: intervalToStore, note });
    const renewNote = intervalToStore != null ? `\n（每 ${intervalToStore} km 自动续期）` : '';
    return `🔔 已设置提醒${tag}\n${type} · 里程达到 ${target.toLocaleString('zh')} km 时提醒${basisNote}${renewNote}`;
  }

  // date mode
  if (!trigger_date) return '日期提醒需要给一个到期日期（如 2027-01-05）。';
  await insertReminder(db, { vehicle_id: vehicleId, type, mode: 'date', trigger_date, note });
  return `🔔 已设置提醒${tag}\n${type} · ${trigger_date} 到期时提醒`;
}

async function listRemindersTool(input: Record<string, unknown>, db: D1Database): Promise<string> {
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

async function cancelReminderTool(input: Record<string, unknown>, db: D1Database): Promise<string> {
  const { type, vehicle } = input as { type: string; vehicle?: string };

  const r = await resolveVehicle(db, vehicle);
  if (r.status === 'not_found') return `没有找到车辆「${r.name}」。`;
  if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, '取消');

  const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
  const count = await cancelReminders(db, { type, vehicleId });
  return count > 0 ? `✅ 已取消「${type}」提醒（${count} 条）。` : `没有找到活跃的「${type}」提醒。`;
}

// ── Record edit / delete tools (spec 004) ─────────────────────────────────────

async function updateLastFuel(input: Record<string, unknown>, db: D1Database): Promise<string> {
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

  // 合并出新值用于回显
  const m = { ...last, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) } as typeof last;
  const pricePerL = (m.price_total / m.liters).toFixed(2);
  return [
    `✏️ 已修改最近一条加油记录${vehicleName ? `（${vehicleName}）` : ''}`,
    `📍 里程：${m.odometer.toLocaleString('zh')} km`,
    `⛽ ${m.liters} L × ¥${pricePerL}/L = ¥${m.price_total}`,
    `📅 ${m.date} · ${m.fuel_type}号`,
  ].join('\n');
}

async function deleteLastFuel(input: Record<string, unknown>, db: D1Database): Promise<string> {
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
