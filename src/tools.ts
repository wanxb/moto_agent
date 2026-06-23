import { ToolDefinition } from './types';
import {
  insertFuelRecord, insertMileageRecord,
  getLastFuelRecord, getRecentFuelRecords, getFuelRecordsByDateRange,
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
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

export async function dispatchTool(
  name: string, input: Record<string, unknown>, db: D1Database
): Promise<string> {
  switch (name) {
    case 'log_fuel':       return logFuel(input, db);
    case 'log_mileage':    return logMileage(input, db);
    case 'query_stats':    return queryStats(input, db);
    case 'get_last_record':return getLastRecord(db);
    default:               return `未知工具：${name}`;
  }
}

// ── Tool implementations ──────────────────────────────────────────────────────

async function logFuel(input: Record<string, unknown>, db: D1Database): Promise<string> {
  const { date, odometer, liters, price_total, fuel_type, note } = input as {
    date: string; odometer: number; liters: number; price_total: number;
    fuel_type?: string; note?: string;
  };

  const prev = await getLastFuelRecord(db);
  await insertFuelRecord(db, { date, odometer, liters, price_total, fuel_type, note });

  const pricePerL = (price_total / liters).toFixed(2);
  let msg = `✅ 已记录\n📍 里程：${odometer.toLocaleString('zh')} km\n⛽ 加油：${liters} L × ¥${pricePerL}/L = ¥${price_total}`;

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
  const { date, odometer, note } = input as { date: string; odometer: number; note?: string };
  await insertMileageRecord(db, { date, odometer, note });
  return `✅ 里程已记录：${(odometer).toLocaleString('zh')} km（${date}）`;
}

async function queryStats(input: Record<string, unknown>, db: D1Database): Promise<string> {
  const { mode, count, start_date, end_date } = input as {
    mode: 'recent' | 'date_range'; count?: number; start_date?: string; end_date?: string;
  };

  let records = mode === 'recent'
    ? (await getRecentFuelRecords(db, (count ?? 5) + 1)).reverse()
    : await getFuelRecordsByDateRange(db, start_date!, end_date!);

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
    '📊 油耗统计',
    '─'.repeat(32),
    ...lines,
    '─'.repeat(32),
    `平均 ${avg} L/100km`,
    `总计 ¥${totalCost.toFixed(0)} / ${totalKm} km`,
  ].join('\n');
}

async function getLastRecord(db: D1Database): Promise<string> {
  const r = await getLastFuelRecord(db);
  if (!r) return '暂无加油记录。';
  const pricePerL = (r.price_total / r.liters).toFixed(2);
  return [
    '🕐 最近一次加油',
    `日期：${r.date}`,
    `里程：${r.odometer.toLocaleString('zh')} km`,
    `加油：${r.liters} L，¥${r.price_total}（¥${pricePerL}/L）`,
    `油品：${r.fuel_type}号`,
  ].join('\n');
}
