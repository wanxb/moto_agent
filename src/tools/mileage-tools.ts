// 纯里程记录工具（spec 001/010）。

import type { Tool } from './interface';
import type { Lang } from '../i18n/types';
import { t, fmtNumber } from '../i18n';
import { resolveVehicle, ambiguousMsg } from './_helpers';
import { insertMileageRecord, getLastFuelRecord } from '../database';

export class LogMileageTool implements Tool {
  readonly name = 'log_mileage';
  readonly description = '记录纯里程（未加油的骑行），用于补全区间距离。';
  readonly descriptionEn = 'Record odometer reading only (no fuel), to supplement distance gaps.';
  readonly parameters = {
    date:     { type: 'string', description: 'ISO 8601 日期' },
    odometer: { type: 'number', description: '当前里程表读数（km）' },
    note:     { type: 'string', description: '备注（可选）' },
    vehicle:  { type: 'string', description: '车辆名称（可选），未传则记到默认车。' },
  } as const;
  readonly required = ['date', 'odometer'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang, userId?: number): Promise<string> {
    const { date, odometer, note, vehicle } = input as {
      date: string; odometer: number; note?: string; vehicle?: string;
    };
    const r = await resolveVehicle(db, vehicle, userId);
    if (r.status === 'not_found') return t('general.vehicle_not_found_add', lang, r.name);
    if (r.status === 'ambiguous') return ambiguousMsg(r.vehicles, t('ambiguous.record', lang), lang);

    const vehicleId = r.status === 'resolved' ? r.vehicle.id : undefined;
    const vehicleName = r.status === 'resolved' ? r.vehicle.name : undefined;

    await insertMileageRecord(db, { date, odometer, note, vehicle_id: vehicleId, user_id: userId });
    const tag = vehicleName ? t('fuel.vehicle_tag', lang, vehicleName) : '';
    let msg = t('mileage.recorded', lang, tag, fmtNumber(odometer, lang), date);

    // odometer 异常检查
    const prev = await getLastFuelRecord(db, vehicleId, userId);
    if (prev && odometer < prev.odometer) {
      msg += '\n\n⚠️ ' + t('fuel.odometer_anomaly', lang, fmtNumber(prev.odometer, lang));
    }

    return msg;
  }
}
