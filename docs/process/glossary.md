# 术语表

> 领域、技术、项目内部用语的统一定义，避免歧义。

---

## 业务领域

| 术语 | 定义 |
|------|------|
| **油耗** | 单位行驶里程的耗油量，本项目用 **L/100km**（升/百公里）。 |
| **fill-to-fill（两次加满法）** | 油耗计算法：用上一次加油量 ÷ 到本次行驶的里程 × 100。精度依赖每次尽量加满。 |
| **里程表读数 / odometer** | 车辆累计行驶里程的**绝对值**（km）。区间里程靠相邻记录相减。 |
| **区间里程** | 两次记录间行驶的距离 = 本次 odometer − 上次 odometer。 |
| **加油记录 / fuel record** | 一次加油：日期、里程、升数、总价、油品。 |
| **纯里程记录 / mileage record** | 未加油时单独记录当前里程，用于补全区间计算。 |
| **油品 / fuel type** | 汽油标号，枚举 `92` / `95` / `98`，默认 `95`。 |
| **默认车 / default vehicle** | 多车场景下，未指明车辆时记录归属的车（Phase 2，见 [spec 001](../specs/001-multi-vehicle/)）。 |

---

## Agent / LLM

| 术语 | 定义 |
|------|------|
| **Agent Loop** | LLM 决策 → 调工具 → 回灌结果 → 再决策的 `while` 循环（`agent.ts`）。 |
| **工具 / Tool** | Agent 与外部世界交互的唯一接口，function-calling 形式（`tools.ts`）。 |
| **工具调度 / dispatch** | 按工具 name 路由到实现函数（`dispatchTool`）。 |
| **轮 / round** | Loop 的一次迭代（一次 LLM 调用 + 可能的工具执行）。上限 `MAX_ROUNDS`。 |
| **Fallback** | 主模型（DeepSeek）失败后自动切备用模型（Claude）（`llm.ts`）。 |
| **System Prompt** | 每次新鲜生成、注入当天日期的系统指令，不入会话历史（`buildSystemPrompt`）。 |
| **会话历史 / session history** | 存 KV 的最近 N 条多轮对话消息（`session:{chatId}`）。 |
| **SDD** | Spec-Driven Development，规格驱动开发（requirements→design→tasks，见 [specs](../specs/)）。 |
| **ADR** | Architecture Decision Record，架构决策记录（[adr/](../engineering/adr/)）。 |

---

## 技术栈

| 术语 | 定义 |
|------|------|
| **Cloudflare Workers** | 边缘 Serverless 运行时，本项目部署目标，无状态短请求。 |
| **D1** | Cloudflare 的 SQLite 兼容关系数据库，存业务数据（绑定 `DB`）。 |
| **KV** | Cloudflare 键值存储，存会话历史，支持 TTL（绑定 `SESSION_KV`）。 |
| **Cron Triggers** | Workers 原生定时触发，Phase 2 提醒功能用。 |
| **Pages** | Cloudflare 静态站点托管，Phase 3 Dashboard 用。 |
| **grammY** | TypeScript Telegram Bot 框架，webhook 模式。 |
| **Miniflare** | 本地模拟 Workers 环境（含 D1/KV），测试用。 |
| **wrangler** | Cloudflare 官方 CLI，开发/部署/数据库管理。 |
| **Webhook Secret** | Telegram 与 Worker 共享的密钥，校验请求真伪。 |
| **nodejs_compat** | Workers 的 Node 兼容标志，能力有限（非完整 Node API）。 |

---

## 项目内部

| 术语 | 定义 |
|------|------|
| **白名单 / ALLOWED_CHAT_ID** | 单用户访问控制，仅该 Telegram chatId 可用。 |
| **只增不删** | schema 演进不变量：只加表/列/索引，不删不改类型，保护历史数据。 |
| **分层纪律** | `index → session → agent → {llm, tools} → database`，上层调下层不反向。 |
| **DoD** | Definition of Done，完成定义（[definition-of-done](definition-of-done.md)）。 |
