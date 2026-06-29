// 被多个工具复用的共享函数（不属于任何单一工具）。

import type { Vehicle } from '../types';
import type { Lang } from '../i18n/types';
import { t, fmtKm, fmtCost } from '../i18n';
import { getVehicleByNameOrAlias, getDefaultVehicle, listVehicles } from '../database';

// ── 车辆解析（所有带 vehicle 参数的工具使用）─────────────────────────────────

export type VehicleResolution =
  | { status: 'resolved'; vehicle: Vehicle }
  | { status: 'not_found'; name: string }
  | { status: 'ambiguous'; vehicles: Vehicle[] }
  | { status: 'none' };

export async function resolveVehicle(db: D1Database, name?: string, userId?: number): Promise<VehicleResolution> {
  if (name) {
    const v = await getVehicleByNameOrAlias(db, name, userId);   // spec 009：全名或别名均可匹配
    return v ? { status: 'resolved', vehicle: v } : { status: 'not_found', name };
  }
  const def = await getDefaultVehicle(db, userId);
  if (def) return { status: 'resolved', vehicle: def };

  const all = await listVehicles(db, userId);
  if (all.length === 0) return { status: 'none' };
  if (all.length === 1) return { status: 'resolved', vehicle: all[0] };
  return { status: 'ambiguous', vehicles: all };
}

/** 多车无默认且未指明时生成反问文案 */
export function ambiguousMsg(vehicles: Vehicle[], verb: string, lang: Lang): string {
  return t('ambiguous.msg', lang, verb, vehicles.map(v => v.name).join('、'));
}

/** 校验 date 不能超过今天（杜绝未来日期录入）。today 可注入便于测试。 */
export function validateDateNotFuture(date: string, lang: Lang, today?: string): string | null {
  const now = today ?? new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  if (date > now) return t('general.future_date', lang, date, now);
  return null;
}

// ── 显示格式化 ───────────────────────────────────────────────────────────────

export { fmtKm, fmtCost };

/** 数字 → 带圈序号①-⑳，超过用 #N */
export function numCircle(n: number): string {
  const circled = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
  return n <= 20 ? circled[n - 1] : `#${n}`;
}
