# 设计：DeepSeek 模型迁移 — deepseek-chat → deepseek-v4-flash

> 规格 014 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md) · [013 分层路由](../013-model-routing/design.md)
> 约束来源：[agent-design](../../engineering/agent-design.md)

## 1. 方案概述

极小改动——改一个配置常量、为两个函数签名加一个可选参数。核心目的是：

1. **截止日前换模型名** `deepseek-chat` → `deepseek-v4-flash`
2. **为分层路由（Spec 013）预留 `deepseek-v4-pro` 的调用能力**——让 `callDeepSeek` 和 `DeepSeekLLM` 接受 `model` 参数

数据流变化：

```
Before:
config.DEEPSEEK_MODEL = 'deepseek-chat'
  → callDeepSeek(messages, tools, apiKey)   // body.model = 'deepseek-chat'（硬编码）

After:
config.DEEPSEEK_MODEL = 'deepseek-v4-flash'
  → callDeepSeek(messages, tools, apiKey, model?)  // body.model = model ?? config.DEEPSEEK_MODEL

Spec 013 叠加后:
new DeepSeekLLM(apiKey, 'deepseek-v4-flash')   // 一层
new DeepSeekLLM(apiKey, 'deepseek-v4-pro')     // 另一层
```

## 2. 数据模型变更

无。

## 3. 工具契约变更

无。

## 4. Prompt 影响

无。

## 5. 数据访问层

无。

## 6. 修改文件

### 6.1 `src/config.ts`

```typescript
export const DEEPSEEK_MODEL = 'deepseek-v4-flash';          // 改：替换旧 deepseek-chat
export const DEEPSEEK_MODEL_PRO = 'deepseek-v4-pro';         // 增：为分层路由预留
```

### 6.2 `src/llm-transport.ts` — `callDeepSeek` 签名

```typescript
export async function callDeepSeek(
  messages: Message[],
  tools: ToolDefinition[],
  apiKey: string,
  model?: string,         // 新增可选参数
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model: model ?? DEEPSEEK_MODEL,   // 不传则用 config 默认值
    // ... 其余不变
  };
```

### 6.3 `src/infra/deepseek-llm.ts`

```typescript
export class DeepSeekLLM implements ILLMProvider {
  constructor(
    private apiKey: string,
    private model?: string,         // 新增可选参数
  ) {}

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    return callDeepSeek(messages, tools, this.apiKey, this.model);
  }
}
```

### 6.4 无变更文件

- `src/agent.ts` — 不改
- `src/index.ts` — 不改
- `src/bootstrap.ts` — 不改（DeepSeekLLM 构造函数不传 model 时默认使用 config.DEEPSEEK_MODEL）
- `src/infra/anthropic-llm.ts` — 不改
- `src/infra/fallback-llm.ts` — 不改

## 7. 边界与错误处理

- **`DEEPSEEK_MODEL` 的值改变后，旧 `callLLM` 会不会出问题？** 旧 `callLLM` 内部调 `callDeepSeek(messages, tools, deepseekKey)`——3 个参数，`model` 走默认，正常使用新模型名。在 Spec 012 删除它之前不会出问题。
- **`test/eval.ts` 调 `callLLM` 会不会受影响？** 同上路径，不受影响。且 Spec 012 会把它改为直接调 `callDeepSeek`。
- **V4 Flash 返回格式是否与 deepseek-chat 一致？** 官方明确表示兼容。如果线上发现差异，随时切回 `DEEPSEEK_MODEL = 'deepseek-chat'`（截止日前可用）。

## 8. 风险与权衡

| 风险 | 缓解 |
|------|------|
| V4 Flash 的工具调用返回格式有细微差异 | 先 staging 冒烟测试（发一条记录加油 + 一条查询），确认 tool_calls 结构一致 |
| 弃用截止日后 deepseek-chat 不可用 | 提前 2 周部署，留观察窗口 |

## 9. 测试要点

- `callDeepSeek` 传 `model` 参数时请求 body 是否包含正确 model name
- `callDeepSeek` 不传 `model` 参数时是否 fallback 到 `DEEPSEEK_MODEL`
- `DeepSeekLLM` 构造传 model / 不传 model 两种情况的调用链正确
- `npm run type-check && npm test` 全绿
