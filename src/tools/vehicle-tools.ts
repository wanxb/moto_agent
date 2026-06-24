// 车辆管理工具（spec 001/005/009/010/011）。

import type { Tool } from './interface';
import type { Lang } from '../i18n/types';
import { t } from '../i18n';
import { resolveVehicle } from './_helpers';
import {
  insertVehicle, getVehicleByName, getVehicleByNameOrAlias, listVehicles,
  setDefaultVehicle, renameVehicle, setVehicleAlias, updateVehicle,
} from '../database';

// ── add_vehicle ───────────────────────────────────────────────────────────────

export class AddVehicleTool implements Tool {
  readonly name = 'add_vehicle';
  readonly description = '添加一辆车。用户说"添加车""新增一辆车 xxx"时调用。';
  readonly descriptionEn = 'Add a vehicle. Call when the user says "add a vehicle...".';
  readonly parameters = {
    name:          { type: 'string', description: '车辆名称，如"小绿"' },
    brand:         { type: 'string', description: '品牌，如本田、雅马哈' },
    model:         { type: 'string', description: '型号，如 CBF190、巧格' },
    fuel_type:     { type: 'string', enum: ['92', '95', '98'], description: '默认油号' },
    tank_capacity: { type: 'number', description: '油箱容量（升）' },
    color:         { type: 'string', description: '颜色' },
  } as const;
  readonly required = ['name'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const { name, brand, model, fuel_type, tank_capacity, color } = input as {
      name: string; brand?: string; model?: string;
      fuel_type?: string; tank_capacity?: number; color?: string;
    };
    const existing = await getVehicleByName(db, name);
    if (existing) return t('vehicle.already_exists', lang, name);
    const isFirst = (await listVehicles(db)).length === 0;
    await insertVehicle(db, name, { isDefault: isFirst, brand, model, fuel_type, tank_capacity, color });
    return isFirst
      ? t('vehicle.added_default', lang, name)
      : t('vehicle.added', lang, name);
  }
}

// ── list_vehicles ─────────────────────────────────────────────────────────────

export class ListVehiclesTool implements Tool {
  readonly name = 'list_vehicles';
  readonly description = '仅列出全部车辆（如"我有哪些车""列表""车辆""我的车"）。其它意图（记录/查询/改名/设默认/保养/提醒）请用对应工具，不要用此工具。';
  readonly descriptionEn = 'List all vehicles. Do NOT use for recording, querying, renaming, or maintenance — use the dedicated tools for those.';
  readonly parameters = {} as const;
  readonly required: string[] = [];

  async execute(_input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const vehicles = await listVehicles(db);
    if (vehicles.length === 0) return t('vehicle.no_vehicles', lang);
    const lines = vehicles.map(v => {
      const label = v.alias ? `${v.name}（${v.alias}）` : v.name;
      return `• ${label}${v.is_default ? t('vehicle.default_mark', lang) : ''}`;
    });
    return [t('vehicle.list_title', lang), ...lines].join('\n');
  }
}

// ── set_default_vehicle ───────────────────────────────────────────────────────

export class SetDefaultVehicleTool implements Tool {
  readonly name = 'set_default_vehicle';
  readonly description = '设置默认车。用户说"默认车设成 xxx""切换到 xxx"时调用。';
  readonly descriptionEn = 'Set the default vehicle. Call when the user says "set X as default" etc.';
  readonly parameters = { name: { type: 'string', description: '要设为默认的车辆名称' } } as const;
  readonly required = ['name'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const { name } = input as { name: string };
    const v = await getVehicleByNameOrAlias(db, name);
    if (!v) return t('general.vehicle_not_found', lang, name);
    await setDefaultVehicle(db, v.id);
    return t('vehicle.set_default_ok', lang, v.name);
  }
}

// ── rename_vehicle (spec 005) ─────────────────────────────────────────────────

export class RenameVehicleTool implements Tool {
  readonly name = 'rename_vehicle';
  readonly description = '修改已有车辆的名称（重命名）。用户说"把X改名叫Y""X改成Y""把X重命名为Y""车名改成Y"时调用——这是改名，不是列出车辆。';
  readonly descriptionEn = 'Rename a vehicle. Call when the user says "rename X to Y".';
  readonly parameters = {
    name:     { type: 'string', description: '车辆当前名称或别名' },
    new_name: { type: 'string', description: '新名称' },
  } as const;
  readonly required = ['name', 'new_name'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const { name, new_name } = input as { name: string; new_name: string };
    if (name === new_name) return t('vehicle.rename_same', lang);
    const v = await getVehicleByNameOrAlias(db, name);
    if (!v) return t('general.vehicle_not_found', lang, name);
    const clash = await getVehicleByName(db, new_name);
    if (clash) return t('vehicle.rename_clash', lang, new_name);
    await renameVehicle(db, v.id, new_name);
    return t('vehicle.renamed', lang, v.name, new_name);
  }
}

// ── set_vehicle_alias (spec 009) ──────────────────────────────────────────────

export class SetVehicleAliasTool implements Tool {
  readonly name = 'set_vehicle_alias';
  readonly description = '给车辆设置一个简称/别名（如"Honda NS125LA"的简称是"小拉"）。用户说"给X起个简称叫Y""X简称Y""X也叫Y"时调用。传空 alias 表示移除简称。';
  readonly descriptionEn = 'Set or remove a vehicle alias/nickname. Pass empty alias to remove.';
  readonly parameters = {
    name:  { type: 'string', description: '车辆全名或现有别名' },
    alias: { type: 'string', description: '新简称（空字符串""表示移除简称）' },
  } as const;
  readonly required = ['name', 'alias'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const { name, alias } = input as { name: string; alias: string };
    const v = await getVehicleByNameOrAlias(db, name);
    if (!v) return t('general.vehicle_not_found', lang, name);
    if (!alias || alias.trim() === '') {
      await setVehicleAlias(db, v.id, null);
      return t('vehicle.alias_removed', lang, v.name);
    }
    const clash = await getVehicleByNameOrAlias(db, alias);
    if (clash && clash.id !== v.id) return t('vehicle.alias_clash', lang, alias);
    await setVehicleAlias(db, v.id, alias.trim());
    return t('vehicle.alias_set', lang, v.name, alias.trim());
  }
}

// ── update_vehicle (spec 011) ─────────────────────────────────────────────────

export class UpdateVehicleTool implements Tool {
  readonly name = 'update_vehicle';
  readonly description = '修改车辆属性（品牌、型号、油号、油箱容量、颜色）。用户说"把XX的YY改成ZZ""删掉XX的YY"时调用。至少传一个属性字段。';
  readonly descriptionEn = 'Update vehicle attributes (brand, model, fuel grade, tank capacity, color).';
  readonly parameters = {
    name:          { type: 'string', description: '车辆名称或别名（用于定位）' },
    brand:         { type: 'string', description: '品牌' },
    model:         { type: 'string', description: '型号' },
    fuel_type:     { type: 'string', enum: ['92', '95', '98'], description: '默认油号' },
    tank_capacity: { type: 'number', description: '油箱容量（升）' },
    color:         { type: 'string', description: '颜色' },
  } as const;
  readonly required = ['name'];

  async execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string> {
    const { name, brand, model, fuel_type, tank_capacity, color } = input as {
      name: string; brand?: string; model?: string;
      fuel_type?: string; tank_capacity?: number; color?: string;
    };
    const v = await getVehicleByNameOrAlias(db, name);
    if (!v) return t('general.vehicle_not_found', lang, name);

    const fields: Record<string, unknown> = {};
    if (brand !== undefined) fields.brand = brand;
    if (model !== undefined) fields.model = model;
    if (fuel_type !== undefined) fields.fuel_type = fuel_type;
    if (tank_capacity !== undefined) fields.tank_capacity = tank_capacity;
    if (color !== undefined) fields.color = color;

    if (Object.keys(fields).length === 0) {
      return t('general.need_one_attr', lang);
    }

    await updateVehicle(db, v.id, fields);

    const attrLabels: Record<string, string> = {
      brand: t('attr.brand', lang), model: t('attr.model', lang),
      fuel_type: t('attr.fuel_type', lang), tank_capacity: t('attr.tank_capacity', lang),
      color: t('attr.color', lang),
    };
    const changed = Object.entries(fields).map(([k, val]) =>
      `${attrLabels[k] ?? k} → ${val === '' ? t('general.cleared', lang) : val}`
    ).join('，');
    return t('vehicle.updated', lang, v.name, changed);
  }
}
