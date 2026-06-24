# Agent 设计：Loop · 工具契约 · Prompt · LLM 策略

> 本文件是新增/修改 Agent 能力的规范来源。配合 [`../../CLAUDE.md`](../../CLAUDE.md) §5 阅读。

---

## 1. Agent Loop 核心

实现见 `src/agent.ts`。采用教程 S01–S04 精简模式：`while` 循环 + `stop_reason` 判断 + 工具调度表。

```
agentLoop(messages):
  working = [systemPrompt, ...messages]
  for round in 0..MAX_ROUNDS:
     resp = callLLM(working, TOOLS)        # llm.ts，含 fallback
     append resp.assistantMessage
     if resp 没有 tool_calls:
        return resp.text                    # 终止：返回最终回复
     for tc in resp.toolCalls:
        result = dispatchTool(tc.name, tc.input, DB)   # 失败被 catch 成可读错误
        append tool 消息(result)
  return "处理超时，请重试。"               # 轮数护栏兜底
```

### 关键设计点

- **`MAX_ROUNDS = 4`**：Workers wall-time 护栏。一次正常交互通常 1–2 轮（调工具 → 回灌 → 出文案）。**不要随意调大**——长任务应拆成异步机制（Phase 4），而非加轮数。
- **双数组写入**：`working`（含 system prompt，喂给 LLM）与 `messages`（调用方持有，回写 KV，不含 system prompt）同步 push。这样 KV 里只存 user/assistant/tool 轮次，system prompt 每次新鲜生成（含当天日期）。
- **工具失败不中断 Loop**：`dispatchTool` 抛错被 `try/catch` 成中文错误字符串回灌给 LLM，让模型决定如何向用户解释。
- **终止条件**：LLM 返回无 `tool_calls` 即终止；否则继续，直到轮数耗尽。

---

## 2. 工具契约（Tool Contract）

工具是 Agent 与外部世界的**唯一**接口。新增能力 = 新增工具，**不是**在 Loop 里加分支。

### 工具的四要素

1. **定义**（`TOOLS` 数组，`src/tools.ts`）：OpenAI function-calling 格式的 JSON Schema。
2. **分发**（`dispatchTool` switch）：`name → 处理函数`。
3. **实现**（处理函数）：业务计算 + 调 `database.ts`，返回**给用户看的最终字符串**。
4. **（可选）prompt 规则**（`agent.ts` 的 `buildSystemPrompt`）：何时调用该工具的高层指引。

### 现有工具一览

| 工具 | 必填参数 | 作用 | 返回 |
|------|---------|------|------|
| `log_fuel` | `date, odometer, liters, price_total`（+ `fuel_type`, `note`, `vehicle`） | 记录加油并算本次油耗 | ✅ 格式化记录 + 油耗 |
| `log_mileage` | `date, odometer`（+ `note`, `vehicle`） | 记录纯里程 | ✅ 已记录提示 |
| `query_stats` | `mode`（`recent`/`date_range`）+ 对应参数（+ `vehicle`） | 区间/最近 N 次油耗统计 | 📊 统计表 |
| `get_last_record` | 无（+ `vehicle`） | 最近一次加油记录 | 🕐 记录详情 |
| `add_vehicle` | `name` | 添加车辆（首辆自动设默认） | ✅ 已添加 |
| `list_vehicles` | 无 | 列出全部车辆 | 🏍 车辆列表 |
| `set_default_vehicle` | `name` | 切换默认车 | ✅ 已切换 |
| `log_maintenance` | `date, type`（+ `odometer`, `cost`, `note`, `vehicle`） | 记录保养（spec 002） | ✅ 已记录保养 |
| `query_maintenance` | 无（+ `type`, `last_only`, `vehicle`） | 查询保养历史 / 某类型最近一次 | 🔧 保养记录 |
| `set_reminder` | `type, mode`（+ `interval_km`/`trigger_odometer`/`trigger_date`, `vehicle`, `note`） | 设提醒（spec 003） | 🔔 已设置提醒 |
| `list_reminders` | 无（+ `vehicle`） | 列活跃提醒 | 🔔 提醒列表 |
| `cancel_reminder` | `type`（+ `vehicle`） | 取消提醒 | ✅ 已取消 |
| `update_last_fuel` | 无（+ 可改字段, `vehicle`） | 改最近一条加油记录（spec 004） | ✏️ 已修改 |
| `delete_last_fuel` | 无（+ `vehicle`） | 软删最近一条加油记录（spec 004） | 🗑 已删除 |

> **定时提醒（spec 003）**是首个非工具触发路径：除上述工具用于"设置/查看/取消"，到期推送由 Cron Triggers → `scheduled()` → `runScheduled()` 完成，不经 Agent Loop。见 [ADR-0006](adr/0006-cron-triggers-scheduled.md) 与 [架构 §2](architecture.md)。

> **车辆解析（spec 001）**：带 `vehicle` 参数的工具统一经内部 `resolveVehicle(db, name?)` 把车名解析为 `vehicle_id`：指定→精确匹配；未指定→默认车；多车无默认→歧义反问；**无任何车辆→按单车/历史模式（vehicle_id 留空，不过滤），与 MVP 行为一致不退化**。详见 [`../specs/001-multi-vehicle/design.md`](../specs/001-multi-vehicle/design.md)。

### 工具设计规范（新增时遵守）

- **描述写清"何时调用"**：LLM 靠 `description` 选工具，把触发条件写进描述（如"用户提供加油信息时调用"）。
- **参数 Schema 完整**：用 `enum` 约束枚举值（如 `fuel_type: ['92','95','98']`）、`required` 标必填、每个字段写 `description`。
- **返回面向用户**：工具直接返回**最终中文文案**（含 emoji 风格），system prompt 已要求 LLM"直接回复不要重述"。这样减少一轮 LLM 调用。
- **业务计算在工具里**：油耗、价格换算等逻辑放工具实现，不放 `database.ts`（保持数据层纯净）、不放 prompt（不靠 LLM 算数）。
- **幂等与校验**：写类工具应对异常输入（除零、负里程）健壮，返回可读错误而非抛栈。
- **失败返回中文错误**：被 Loop 捕获后回灌给 LLM。

> 实操步骤（DB → tool → test → doc）见 [`../../CLAUDE.md`](../../CLAUDE.md) §5。

---

## 3. System Prompt 策略

实现见 `agent.ts` 的 `buildSystemPrompt()`。原则：

- **精简**：高层规则放 system prompt，具体"怎么调"放工具 `description`。避免两边重复。
- **动态注入当天日期**：`buildSystemPrompt` 每次注入 `今天的日期`，让 LLM 正确处理"今天/默认日期"。
- **明确澄清规则**：如"只有总价没升数时先问"——把产品的[澄清优先原则](../product/personas.md#5-设计原则从画像推导)编码进 prompt。
- **指定输出语言与风格**：中文、简洁。

新增工具时若需要新规则，**加最小必要的一两条**，不要让 prompt 膨胀。

---

## 4. LLM 策略：主备双模型与 Fallback

实现见 `src/llm.ts`。

### Provider 抽象

统一 `callLLM(messages, tools, deepseekKey, anthropicKey) → LLMResponse`。上层（`agent.ts`）不感知用的是哪个模型。

| 角色 | 模型 | 格式 | 选型理由 |
|------|------|------|---------|
| 主 | DeepSeek V3 (`deepseek-chat`) | OpenAI 兼容 | 中文强、工具调用稳、成本极低 |
| 备 | Claude Sonnet (`claude-sonnet-4-6`) | Anthropic messages | DeepSeek 故障时保可用性 |

> 决策详情见 [ADR-0003](adr/0003-deepseek-primary-claude-fallback.md)。

### Fallback 逻辑

```
for attempt in 0..2:
   try: return callDeepSeek()
   catch e:
      if not isRetryable(e): throw e        # 4xx：配置/请求错误，立即抛出，不 fallback
      if attempt == 2: break                # 3 次 5xx/429 耗尽
      sleep(500 * 2^attempt)                # 指数退避：0.5s, 1s
return callAnthropic()                       # 切备用模型
```

- **可重试**：429（限流）、5xx（服务端）。
- **不可重试（直接抛）**：4xx（如 401 鉴权、400 请求格式）——fallback 也救不了，快速失败。
- 顶层（`session.ts`）再兜一层，整体失败回复"出错了，请稍后重试"。

### 消息格式互转（改 llm.ts 必看）

内部统一用 **OpenAI 格式**（`Message` 类型）。调 Anthropic 前用 `toAnthropicMessages()` 转换：

| OpenAI | Anthropic |
|--------|-----------|
| `system` 消息 | 顶层 `system` 字段 |
| `user` / `assistant` 文本 | `content: [{type:'text'}]` |
| `assistant.tool_calls` | `content: [{type:'tool_use', id, name, input}]` |
| 连续 `tool` 结果 | 合并为一条 `user` 消息，`content: [{type:'tool_result', tool_use_id}]` |

工具定义也要转：OpenAI 的 `function.parameters` → Anthropic 的 `input_schema`。

> **改 `llm.ts` 的铁律**（[`../../CLAUDE.md`](../../CLAUDE.md) §2-4）：DeepSeek 与 Anthropic 两条路径都要测，格式转换不能漏 `tool_use`/`tool_result` 配对。

---

## 5. 会话上下文管理

见 `src/session.ts`：

- 每 `chatId` 一份历史，存 KV `session:{chatId}`，**保留最近 `MAX_SESSION_MESSAGES = 10` 条**，**TTL `SESSION_TTL = 3600`s（1h）**。
- system prompt **不入**历史（每次新鲜生成）。
- 截断策略：`messages.slice(-10)`——简单尾部保留。复杂多轮澄清可能丢早期上下文（已知取舍，见 [`../../PRD.md`](../../PRD.md) §11）。

> 当前不引入上下文压缩/持久记忆（教程 S08/S09），Phase 4 视需要再加。

---

## 6. 不引入的复杂机制（MVP/Phase 2）

明确**不做**，避免过度工程化（对齐 [`../../PRD.md`](../../PRD.md) §5.3）：

| 机制 | 教程 | 何时再考虑 |
|------|------|-----------|
| 子智能体 | S06 | Phase 3+ 异步查询任务 |
| 上下文压缩 | S08 | 多轮上下文明显溢出时 |
| 持久记忆 | S09 | 需要跨会话长期记忆时 |
| 后台任务 | S13 | Phase 2 提醒用 Cron Triggers 替代 |
| 多智能体 | S15 | 远期 |

---

## 7. 扩展 Agent 的决策树

```
要加新能力？
├─ 是一个"动作/查询"（记录、统计、提醒…）
│    → 加一个工具（§2），90% 的情况走这里
├─ 是"换/加一个模型 provider"
│    → 改 llm.ts，保持 callLLM 接口不变，两条路径都测（§4）
├─ 是"改变循环行为"（轮数、终止、压缩…）
│    → 改 agent.ts，需谨慎，可能要写 ADR
└─ 是"定时/异步触发"
     → 用 Cloudflare Cron Triggers（Phase 2 提醒），不要加轮数或阻塞
```
