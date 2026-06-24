import type { ToolDefinition } from '../types';

// ── Tool 接口：每个工具 = name + JSON Schema + execute ──────────────────────
// 新增工具只需实现此接口并调用 registry.register()，不改 Registry 也不改 dispatch。

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;    // JSON Schema（function-calling 的 parameters）
  required: string[];                     // 必填参数名列表
  execute(input: Record<string, unknown>, db: D1Database): Promise<string>;
}

// ── ToolRegistry：收集 + 生成 OpenAI 格式 + 分发 ────────────────────────────
// 替代旧的 TOOLS 数组 + dispatchTool switch。

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 生成 OpenAI/DeepSeek function-calling 的 tools 数组 */
  toOpenAI(): ToolDefinition[] {
    const defs: ToolDefinition[] = [];
    for (const t of this.tools.values()) {
      defs.push({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: t.parameters,
            required: t.required,
          },
        },
      });
    }
    return defs;
  }

  /** 按 name 分发执行 */
  async dispatch(name: string, input: Record<string, unknown>, db: D1Database): Promise<string> {
    const tool = this.get(name);
    return tool ? tool.execute(input, db) : `未知工具：${name}`;
  }
}
