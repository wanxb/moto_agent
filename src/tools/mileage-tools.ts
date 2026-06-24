// 纯里程记录工具。

import type { Tool } from './interface';
import { resolveVehicle, ambiguousMsg } from './_helpers';
import { insertMileageRecord } from '../database';

export class LogMileageTool implements Tool {
  readonly name = 'log_mileage';
  readonly description = '记录纯里程（未加油的骑行），用于补全区间距离。';
  readonly parameters = {
    date:     { type: 'string', description: 'ISO 8601 日期' },
    odometer: { type: 'number', description: '当前里程表读数（km）' },
    note:     { type: 'string', description: '备注（可选）' },
    vehicle:  { type: 'string', description: '车辆名称（可选），未传则记到默认车。' },
  } as const;
  readonly required = ['date', 'odometer'];

  async execute(input: Record<string, unknown>, db: D1Database): Promise<string> {
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
}
