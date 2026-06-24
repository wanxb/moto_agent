# 编码规范

> 与现有代码风格一致。AI 编码助手与人类共同遵守。摘要版在 [`../../CLAUDE.md`](../../CLAUDE.md) §6。

---

## 1. 语言与类型

- **TypeScript，`strict: true`**（`tsconfig.json`）。`tsc --noEmit` 是唯一静态门禁，等价于 lint。
- **禁用 `any`**。外部数据先 `unknown` 再收窄（参考 `llm.ts` 对 API response 的 `as` + 类型谓词写法）。
- 目标 `ES2022` / `ESNext` 模块 / `Bundler` 解析（Workers 运行时）。

## 2. 模块与导出

- ESM，**命名导出**为主。仅 `src/index.ts` 默认导出 Workers handler。
- 单一职责：一个文件一层职责（见 [架构 §2 分层纪律](../engineering/architecture.md)）。业务计算在 `tools.ts`，SQL 在 `database.ts`，编排在 `agent.ts`/`session.ts`。

## 3. 命名

| 对象 | 风格 | 例 |
|------|------|----|
| 函数/变量 | `camelCase` | `getLastFuelRecord` |
| 类型/接口 | `PascalCase` | `FuelRecord`, `LLMResponse` |
| 常量 | `UPPER_SNAKE` | `MAX_ROUNDS`, `SESSION_TTL` |
| SQL 列 | `snake_case` | `price_total`, `vehicle_id` |
| 日志前缀 | `[模块]` | `[tool]`, `[llm]` |

## 4. 错误处理

- **工具执行失败返回中文可读错误字符串**，不抛出中断 Loop（参考 `agent.ts` 的 try/catch → 回灌 LLM）。
- 顶层 `index.ts` 兜底 500；`session.ts` 兜底"出错了，请稍后重试"。
- LLM 层区分可重试（429/5xx）与不可重试（4xx）（见 [agent-design §4](../engineering/agent-design.md)）。
- 不吞异常不报：catch 后必须 `console.error('[模块]', e)`。

## 5. 数据库

- **一律参数化绑定** `.bind(...)`，禁止字符串拼接 SQL（防注入，[security](../engineering/security.md)）。
- `database.ts` 只做数据进出，无业务计算。
- 改 schema 走[迁移纪律](../engineering/data-model.md) §5（只增不删，三处同步）。

## 6. LLM / 工具

- 新能力 = 新工具，不在 Loop 加分支（[agent-design §2](../engineering/agent-design.md)）。
- 工具 `description` 写清"何时调用"；参数用 `enum`/`required`/`description` 完整描述。
- 改 `llm.ts` 必须 DeepSeek + Anthropic 两条路径都测。

## 7. 用户可见文案

- 支持中英双语：i18n 文案使用 `t('key', lang, ...args)` 模式获取翻译，翻译字典统一在 `src/i18n/` 维护。
- **中文**，简洁。
- 沿用现有 emoji 风格：✅ 成功 · ⛽ 加油 · 📊 统计 · 🕐 时间/最近 · 📍 里程 · 🏍 车辆。
- 数字格式化沿用现有（`toLocaleString('zh')`、`toFixed(2)`）。
- 工具描述：`description` 保留中文为主/fallback，可选 `descriptionEn` 提供英文版描述，`ToolRegistry.toOpenAI(lang)` 按语言偏好选取。

## 8. 注释

- 解释**为什么**，不解释**做了什么**（代码自解释）。
- 与现有密度一致，不写废话注释。
- 复杂取舍（如"按 odometer 排序而非 date"）值得一行注释说明原因。

## 9. 异步

- 全 `async/await`，不混 `.then` 链（除非简单场景如 `llm.ts` 的 `.then(v => ...)`）。
- Workers 无状态：**禁止模块级可变状态**存跨请求数据（[CLAUDE.md §2](../../CLAUDE.md)）。

## 10. 依赖

- 生产依赖保持最小（当前仅 `grammy`）。新增前确认 Workers 运行时兼容（无完整 Node API），PR 说明理由。

## 11. 测试

- 新功能必带测试；改 bug 先写复现测试。LLM 必 mock。详见 [测试策略](../engineering/testing-strategy.md)。
