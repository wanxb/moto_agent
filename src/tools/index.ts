// 工具注册中心 —— 兼容旧 TOOLS + dispatchTool 导出，底层用 ToolRegistry。
// 新增工具：实现 Tool 接口，在此处 register()，无需改其它文件。

import type { ToolDefinition } from '../types';
import { ToolRegistry } from './interface';

// Fuel
import { LogFuelTool, QueryStatsTool, GetLastRecordTool, UpdateLastFuelTool, DeleteLastFuelTool } from './fuel-tools';
// Vehicle
import { AddVehicleTool, ListVehiclesTool, SetDefaultVehicleTool, RenameVehicleTool, SetVehicleAliasTool } from './vehicle-tools';
// Mileage
import { LogMileageTool } from './mileage-tools';
// Maintenance
import { LogMaintenanceTool, QueryMaintenanceTool } from './maintenance-tools';
// Reminder
import { SetReminderTool, ListRemindersTool, CancelReminderTool } from './reminder-tools';

// ── 注册所有工具 ─────────────────────────────────────────────────────────────

export const registry = new ToolRegistry()
  .register(new LogFuelTool())
  .register(new LogMileageTool())
  .register(new QueryStatsTool())
  .register(new GetLastRecordTool())
  .register(new AddVehicleTool())
  .register(new ListVehiclesTool())
  .register(new SetDefaultVehicleTool())
  .register(new RenameVehicleTool())
  .register(new SetVehicleAliasTool())
  .register(new LogMaintenanceTool())
  .register(new QueryMaintenanceTool())
  .register(new SetReminderTool())
  .register(new ListRemindersTool())
  .register(new CancelReminderTool())
  .register(new UpdateLastFuelTool())
  .register(new DeleteLastFuelTool());

// ── 兼容旧接口（agent.ts / eval.ts / 测试 沿用） ────────────────────────────────

/** OpenAI function-calling 格式的工具定义数组 */
export const TOOLS: ToolDefinition[] = registry.toOpenAI();

/** 按 name 分发执行（兼容旧的 dispatchTool 签名） */
export async function dispatchTool(
  name: string, input: Record<string, unknown>, db: D1Database
): Promise<string> {
  return registry.dispatch(name, input, db);
}
