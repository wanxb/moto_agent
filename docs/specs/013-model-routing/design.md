# 设计：分层模型路由 — 简单请求走便宜模型，复杂请求走强模型

> 规格 013 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md) · [012 路径统一](../012-arch-refactor/design.md)
> 约束来源：[agent-design](../../engineering/agent-design.md)

## 1. 方案概述

在 `ILLMProvider` 接口之上新增一个路由层——`RouterLLM` 实现同一个接口，对 `agent.ts` 完全透明。RouterLLM 内部根据 `classifyComplexity()` 的判定结果，将请求分派到两套 `FallbackLLM` 之一：

```
agent.ts: runAgentLoop(messages, llm, ...)
                          ↓  llm 是 RouterLLM（对 Loop 透明）
RouterLLM.chat(messages, tools)
     │
     ├─ classifyComplexity(messages)
     │     │
     │     ├─ 'simple'  → simpleProvider.chat()    // FallbackLLM(V4 Flash ×3 → V4 Pro ×1)
     │     └─ 'complex' → complexProvider.chat()    // FallbackLLM(V4 Pro ×3 → V4 Flash ×1)
     │
     └─ 返回 LLMResponse
```

## 2. 数据模型变更

无。

## 3. 工具契约变更

无。RouterLLM 不感知工具，不透传工具。

## 4. Prompt 影响

无。System prompt 内容不变。

## 5. 数据访问层

无。

## 6. 新增/修改文件

### 6.1 新增文件

**`src/router/classifier.ts`** — `classifyComplexity()` 函数：

```typescript
import type { Message } from '../types';

export type Complexity = 'simple' | 'complex';

export function classifyComplexity(messages: Message[]): Complexity {
  const last = messages[messages.length - 1];
  if (last.role !== 'user') return 'complex';
  const text = last.content.trim();

  // ── 简单问候/确认（零或极低 LLM 需求）──
  if (/^(hi|hello|hey|你好|嗨|早|谢谢|thanks|ok|好的|明白|再见|bye|晚安)\b/i.test(text)) {
    return 'simple';
  }
  // 极短消息 + 无数字（纯聊天）
  if (text.length < 15 && !/\d/.test(text)) return 'simple';

  // ── 复杂触发词（需要强模型推理）──
  // 故障排查
  if (/(故障|异响|报警|灯亮|怎么.*修|为什么|打不着|漏|抖|声音大)/.test(text)) return 'complex';
  // 复合意图（逗号/分号分隔且跨领域）
  if (/[，,、；;]/.test(text) && /(加油|油耗|保养|换|提醒|查)/.test(text)) return 'complex';
  // 显式"同时/顺便/另外"连接不同操作
  if (/(同时|顺便|另外|还有|和|与)/.test(text) && /(保养|油耗|里程|换|查)/.test(text)) return 'complex';
  // 计算/统计/对比
  if (/(平均|统计|区间|计算|总共|对比|哪个.*省|分析)/.test(text)) return 'complex';

  // ── 默认：走便宜模型 ──
  return 'simple';
}
```

**`src/router/router-llm.ts`** — `RouterLLM` 类：

```typescript
import type { ILLMProvider } from '../ports';
import type { Message, LLMResponse, ToolDefinition } from '../types';
import { classifyComplexity, type Complexity } from './classifier';

export class RouterLLM implements ILLMProvider {
  constructor(
    private simple: ILLMProvider,
    private complex: ILLMProvider,
  ) {}

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const tier = classifyComplexity(messages);
    const provider = tier === 'simple' ? this.simple : this.complex;

    console.log(`[router] tier=${tier} messages=${messages.length} tools=${tools.length}`);

    try {
      return await provider.chat(messages, tools);
    } catch (e) {
      // simple provider 挂了 → 升级到 complex 重试（跨层自愈）
      if (tier === 'simple') {
        console.log('[router] simple failed, escalate to complex');
        return this.complex.chat(messages, tools);
      }
      throw e;
    }
  }
}
```

**`src/router/index.ts`** — barrel export：

```typescript
export { RouterLLM } from './router-llm';
export { classifyComplexity } from './classifier';
export type { Complexity } from './classifier';
```

### 6.2 修改文件

**`src/bootstrap.ts`** — 组装 RouterLLM：

```typescript
// 创建 3 个 provider 实例
const flash = new DeepSeekLLM(env.DEEPSEEK_API_KEY, 'deepseek-v4-flash');
const pro = new DeepSeekLLM(env.DEEPSEEK_API_KEY, 'deepseek-v4-pro');
// const anthropic = new AnthropicLLM(env.ANTHROPIC_API_KEY);  // 保留可恢复

// 组装两层 Fallback
const simpleLayer = new FallbackLLM(flash, pro, 3);    // Flash ×3 → Pro ×1
const complexLayer = new FallbackLLM(pro, flash, 3);   // Pro ×3 → Flash ×1

// 路由层
const llm = new RouterLLM(simpleLayer, complexLayer);
```

### 6.3 无变更文件

- `src/agent.ts` — `RouterLLM` 只实现了 `ILLMProvider`，agent loop 零改动
- `src/prompts.ts` — 不改
- `src/tools/` — 不改
- `src/index.ts` — 不改（统一路径后已从 bootstrap 取 llm）
- `src/session-store/` — 不改

## 7. 边界与错误处理

- **classifyComplexity 输入为空消息**：取 `last.role` 会得到 undefined，`last.content` 会抛出——应加 `messages.length === 0` 的保护，返回 `'complex'`（安全方向）。
- **simple 层挂了（重复 429/5xx）**：RouterLLM catch 后升级到 complex 层重试。如果 complex 也挂了，异常冒泡到 pipeline 的 catch 中，回复"出错了请重试"。
- **classifyComplexity 误判为 simple 导致质量差**：system prompt 中已要求 LLM"不确定时向用户确认"，V4 Flash 本身工具调用能力不弱。误判的代价是"多一轮对话"，不是"数据出错"。
- **classifyComplexity 误判为 complex 多花钱**：V4 Pro 比 Flash 贵 3×，但比 Claude Sonnet 便宜 86%。风险可控。

## 8. 风险与权衡

| 风险 | 缓解 |
|------|------|
| classifyComplexity 规则漏掉某些需要强模型的场景 | 初始阈值偏保守（宁可判 complex），上线后通过 console.log 观察分布调整 |
| V4 Flash 思考模式可能更好用但未启用 | V4 Flash 支持思考/非思考双模式，如需可在 RouterLLM 中加"尝试 Flash 思考模式 → 不理想切 Pro"的升级路径 |
| 新增 src/router/ 增加了模块数 | 只有 2 个实现文件 + 1 个 index，共 ~80 行，远低于删掉的 session.ts |

## 9. 测试要点

- `classifyComplexity()` 单元测试覆盖：
  - 空消息 → `'complex'`
  - 纯问候 → `'simple'`
  - 单意图加油 → `'simple'`
  - 复合意图（"加油并查保养"）→ `'complex'`
  - 故障排查（"发动机异响"）→ `'complex'`
  - 多车查询+统计对比 → `'complex'`
- `RouterLLM` 单元测试覆盖：
  - simple 消息 → 调用 simple provider
  - complex 消息 → 调用 complex provider
  - simple provider 失败 → 自动升级到 complex provider
- 集成测试：通过 `bootstrap.ts` 验证 RouterLLM 可正确组装
- `npm run type-check && npm test` 全绿
