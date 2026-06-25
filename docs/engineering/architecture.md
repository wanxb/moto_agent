# 系统架构

> 本文件是工程层的总入口。深入子主题见：[数据模型](data-model.md) · [Agent 设计](agent-design.md) · [测试策略](testing-strategy.md) · [安全](security.md) · [可观测与运维](observability-ops.md) · [ADR](adr/)。

---

## 1. 架构概览

单 Cloudflare Worker，webhook 驱动，无状态。所有持久状态外置到 D1（业务数据）与 KV（会话历史）。

```
┌──────────────┐   webhook POST /telegram    ┌────────────────────────────────────────────┐
│  Telegram     │ ──────────────────────────► │            Cloudflare Worker                │
│  服务器        │ ◄────────────────────────── │            (src/index.ts)                    │
└──────────────┘   sendMessage (Bot API)      │                                              │
                                              │  ① 鉴权中间件                                  │
                                              │     · webhook secret 校验                     │
                                              │     · ALLOWED_CHAT_ID 白名单                   │
                                              │             │                                │
                                              │  ② 会话编排 (session.ts)                       │
                                              │     · 从 KV 读历史 ──────────────────────────┼──► KV (session:{chatId})
                                              │     · 调 Agent Loop                           │
                                              │     · 写回 KV（截断 10 条，TTL 1h）            │
                                              │             │                                │
                                              │  ③ Agent Loop (agent.ts)                      │
                                              │     while round < MAX_ROUNDS:                 │
                                              │       resp = callLLM(msgs, tools) ───────────┼──► DeepSeek V3（主）
                                              │       if no tool_call: return text           │   └► Claude Sonnet（备/fallback）
                                              │       dispatch(tool_calls)                    │      (llm.ts)
                                              │             │                                │
                                              │  ④ 工具层 (tools.ts)                          │
                                              │     log_fuel / log_mileage /                 │
                                              │     query_stats / get_last_record ───────────┼──► D1 (database.ts)
                                              │             │                                │
                                              │  ⑤ 回复用户 (Bot API)                         │
                                              └──────────────────────────────────────────────┘
                                                          │                    │
                                                   Cloudflare D1         Cloudflare KV
                                                 (fuel_records 等)     (chatId → 对话历史)
```

---

## 2. 组件与职责（C4 Container 级）

| 组件 | 文件 | 职责 | 不负责 |
|------|------|------|--------|
| **Webhook 入口** | `src/index.ts` | grammY bot、webhook secret 校验、命令路由、文本/**语音**消息路由、访问控制中间件 | 业务逻辑 |
| **定时入口** | `src/index.ts` `scheduled()` + `src/scheduled.ts` | Cron Triggers 唤醒，扫描到期提醒并主动推送（spec 003） | 业务计算、SQL |
| **语音转写** | `src/stt.ts` | `transcribe()`：Workers AI Whisper 把语音 OGG 转中文文本（spec 008） | 业务逻辑 |
| **编排管道** | `src/gateway/pipeline.ts` + `TelegramAdapter` | 语言检测、限流、会话读写（`ISessionStore`）、调 Agent Loop、截断历史、回复前 `toPlainText` 清洗 markdown（spec 005） | LLM 细节、SQL |
| **输出格式化** | `src/format.ts` | `toPlainText`：去 markdown 保留 emoji，供 Telegram 纯文本显示 | 业务逻辑 |
| **国际化** | `src/i18n/` + `src/prompts.ts` | `t(key, lang, ...args)` 翻译函数；KV 存 `lang:{chatId}` 偏好；系统提示中英双语；`ToolRegistry.toOpenAI(lang)` 按语言选工具描述 | 业务逻辑 · [ADR-0008](adr/0008-i18n-bilingual.md) |
| **Agent Loop** | `src/agent.ts` | system prompt、`while` 循环、工具调度、轮数护栏 | 具体工具实现、HTTP |
| **LLM 适配** | `src/llm.ts` | DeepSeek/Anthropic 双 provider、重试、fallback、消息格式互转 | 业务、存储 |
| **工具层** | `src/tools/` | 工具 JSON Schema 定义、`dispatchTool` 分发、业务计算（油耗等） | SQL 细节 |
| **数据访问** | `src/database.ts` | 纯 SQL 的 D1 CRUD | 业务计算 |
| **类型** | `src/types.ts` | `Env`、消息/工具/LLM/记录类型 | — |

> **分层纪律**：`index → bootstrap → pipeline → agent → {llm, tools} → database`。上层可调下层，下层不反向依赖。业务计算集中在 `tools.ts`，`database.ts` 只做数据进出。

---

## 3. 请求生命周期（一次"加油记录"）

1. 用户在 Telegram 发"加了 10 升 95 号花了 98 里程 12580"。
2. Telegram POST 到 `/telegram`，带 `X-Telegram-Bot-Api-Secret-Token`。
3. `index.ts` 校验 secret → 失败 401；通过则 grammY 接管。
4. 访问控制中间件校验 `chat.id == ALLOWED_CHAT_ID`，否则拒绝。
5. `message:text` handler → `bootstrap(env)` → `TelegramAdapter(ctx, env)` → `app.run(adapter, { text })`。
6. `pipeline.ts` 接管执行：语言检测（`TelegramAdapter.detectLanguage`）→ 限流（`rate-limiter.ts`）→ `ISessionStore.get(chatId)` 读 KV 历史 → push 当前消息。
7. `runAgentLoop(messages, llm, tools, registry, db, lang)`：拼接 system prompt，调 `llm.chat()`。
8. `llm.chat()`（经 `ILLMProvider` 派发）请求 DeepSeek/Claude；返回 `tool_calls`（`log_fuel`）。
9. `agent.ts` `registry.dispatch('log_fuel', ...)` → `tools.logFuel()` → `database.insertFuelRecord()` 写 D1，并计算本次油耗。
10. 工具结果作为 `tool` 消息回灌，Loop 再调 LLM；LLM 无新工具调用，返回最终文案。
11. `pipeline.ts` `trimHistory()` 截断 → `ISessionStore.set()` 写回 KV（TTL 1h）→ `adapter.reply()` 经 Bot API 回复用户。

> 关键时序与超时护栏（`MAX_ROUNDS`）见 [`agent-design.md`](agent-design.md)。

---

## 4. 状态管理（无状态运行时的状态）

Workers 每请求独立、可能落在不同数据中心，**进程内无持久状态**。

| 状态种类 | 存哪 | Key/结构 | 生命周期 |
|---------|------|---------|---------|
| 会话历史（多轮上下文） | **KV** `SESSION_KV` | `session:{chatId}` → JSON 消息数组 | 最近 10 条，TTL 1h |
| 业务数据（加油/里程） | **D1** `DB` | 关系表 | 永久 |
| 密钥/配置 | Workers Secrets / `wrangler.toml` bindings | — | 部署期 |

> 因此：**严禁用模块级变量存跨请求状态**（见 [`../../CLAUDE.md`](../../CLAUDE.md) §2）。

---

## 5. 外部依赖

| 依赖 | 用途 | 失败处理 |
|------|------|---------|
| Telegram Bot API | 收发消息 | webhook 重试由 Telegram 负责；回复失败记日志 |
| DeepSeek V3 API | 主 LLM | 429/5xx 重试 3 次 → fallback Claude |
| Anthropic API | 备 LLM | 失败则整体降级，回复"出错了" |
| Cloudflare D1 | 业务存储 | 异常被工具层捕获，返回中文错误给 LLM |
| Cloudflare KV | 会话存储 | 读失败按空历史处理（无上下文但不崩） |

---

## 6. 横切关注点

| 关注点 | 现状 | 文档 |
|--------|------|------|
| 安全/鉴权 | webhook secret + chatId 白名单 | [security.md](security.md) |
| 国际化 | ✅ 已实现：`src/i18n/` + 系统提示/工具描述/输出双语 | [ADR-0008](adr/0008-i18n-bilingual.md) |
| Web Dashboard | ✅ 已实现：Worker 内嵌 HTML + Chart.js + REST API，只读可视化，token 鉴权 | [ADR-0009](adr/0009-phase3-dashboard.md) |
| 可观测性 | `console.log` 前缀化 → Logpush | [observability-ops.md](observability-ops.md) |
| 错误处理 | 工具层 try/catch 返回可读错误；顶层 500 兜底 | 本文 §5 |
| 配置 | Secrets via `wrangler secret put` | [observability-ops.md](observability-ops.md) |
| 数据演进 | schema 只增不删 + 迁移 | [data-model.md](data-model.md) |

---

## 7. 架构演进方向（与路线图对齐）

| Phase | 架构变化 |
|-------|---------|
| 2 | D1 加 `vehicles`/`maintenance_records`/`reminders` 表 ✅；Cron Triggers（提醒）✅；可能加 Whisper 工具 |
| 3 | 加 Cloudflare Pages（Dashboard）；多用户数据隔离；鉴权层 |
| 4 | 可能拆分多 Worker、引入时序数据（OBD/GPS）、事件驱动 |

> **不变量**：留在 Cloudflare 生态、模型层可替换、工具层与 Bot 层解耦。详见 [`../product/roadmap.md`](../product/roadmap.md) 与各 [ADR](adr/)。

---

## 8. 已知架构约束

- 单请求 wall-time 有限 → Agent Loop 轮数受 `MAX_ROUNDS` 约束，不能做长任务。
- Workers 运行时非完整 Node（`nodejs_compat` 有限）→ 依赖选型受限。
- KV 最终一致 → 会话历史在极端并发下可能短暂不一致（单用户场景可忽略）。
- D1 单库容量与写并发有上限（MVP/Phase 2 远未触及）。
