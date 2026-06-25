# CLAUDE.md — Agent 操作手册

> 本文件是 AI 编码助手（Claude Code 等）在本仓库工作的**首要操作手册**。
> 人类开发者请从 [`docs/README.md`](docs/README.md) 开始；产品需求看 [`docs/PRD.md`](docs/PRD.md)。
> 跨工具的 Agent（Cursor / Copilot 等）入口见 [`AGENTS.md`](AGENTS.md)，内容以本文件为准。

---

## 1. 这是什么项目

**摩托车油耗管理 Telegram Bot。** 用户用自然语言在 Telegram 里记录加油（里程、升数、价格），系统通过 LLM 解析后写入数据库并计算油耗，支持查询统计。

- **形态**：Telegram Bot（webhook 模式），无前端页面。
- **运行时**：Cloudflare Workers（边缘 Serverless，单请求无状态）。
- **AI**：自实现 Agent Loop（`while` 循环 + 工具调度），DeepSeek V3 主、Claude Sonnet 备，自动 fallback。
- **状态**：MVP 已跑通，205 个测试通过。Phase 2 功能扩展已全部完成，进入 Phase 3 多用户规划。

完整背景：[`docs/PRD.md`](docs/PRD.md) · [`docs/engineering/architecture.md`](docs/engineering/architecture.md)

---

## 2. 黄金法则（先读这一节）

1. **改动前先看 spec。** 任何非平凡功能改动，先确认 [`docs/specs/`](docs/specs/) 下有没有对应规格；没有就先按 [`docs/specs/README.md`](docs/specs/README.md) 的 SDD 流程补 `requirements → design → tasks`，再写代码。
2. **保持无状态思维。** Workers 每个请求独立、可能跨数据中心。**不要**用模块级变量存跨请求状态——会话历史一律走 `SESSION_KV`，业务数据一律走 `DB`（D1）。
3. **工具是 Agent 与世界的唯一接口。** 新增能力 = 新增一个工具（`src/tools/` 目录），而不是在 `agent.ts` 里塞 if-else。工具契约见 [`docs/engineering/agent-design.md`](docs/engineering/agent-design.md)。
4. **两个 LLM provider 必须同时支持。** 任何改 `src/llm.ts` 的改动，DeepSeek（OpenAI 兼容格式）和 Anthropic（messages 格式）两条路径都要测到，消息格式转换不能漏。
5. **不写注释解释"做了什么"，写注释解释"为什么"。** 代码风格匹配现有文件（见 §6）。
6. **改完必须 `npm run type-check && npm test` 全绿**，否则任务不算完成（见 [`docs/process/definition-of-done.md`](docs/process/definition-of-done.md)）。
7. **绝不提交 secrets。** `.dev.vars` 已被 gitignore；线上密钥用 `wrangler secret put`。任何 key/token 不进 git。

---

## 3. 常用命令

```bash
npm install              # 安装依赖
npm run dev              # 本地启动 Worker（wrangler dev）
npm test                 # 跑全部测试（vitest run，当前 205 个）
npm run test:watch       # 监听模式
npm run type-check       # tsc --noEmit，类型检查
npm run db:init          # 初始化本地 D1（docs/schema.sql）
npm run db:init:remote   # 初始化线上 D1
npm run deploy           # 部署到 Cloudflare Workers
npm run ingest-knowledge  # 知识库入库（OCR → 分块）
npm run populate-vectorize # 知识库向量索引灌入
npm run test-knowledge    # 离线评测知识库检索质量
```

> 没有独立的 lint/format 命令；`tsc --strict` 是唯一的静态门禁。提交前至少跑 `type-check` + `test`。

部署 / Webhook 注册 / Secrets 配置的完整流程见 [`docs/engineering/observability-ops.md`](docs/engineering/observability-ops.md) 与 [`README.md`](README.md)。

---

## 4. 代码地图

| 文件 | 职责 | 改动时注意 |
|------|------|-----------|
| `src/index.ts` | Workers 入口；grammY bot、webhook 鉴权、命令路由、访问控制中间件 | 改鉴权要同步更新 [`docs/engineering/security.md`](docs/engineering/security.md) |
| `src/config.ts` | 集中配置：`MAX_ROUNDS`、模型 ID、`SESSION_TTL`、可编辑列白名单等 | 改值要评估影响范围 |
| `src/agent.ts` | Agent Loop 核心：system prompt、`while` 循环、工具分发、轮数上限 | `MAX_ROUNDS` 是 Workers 超时护栏；`lang` 参数传递给工具和 prompt；通过 `ILLMProvider` 接口调用模型 |
| `src/bootstrap.ts` | 依赖注入容器：将 Env 组装为 App（llm / session / messenger / agent） | 新增模型层/路由策略时在此组合 |
| `src/gateway/pipeline.ts` | 消息编排管道：语言检测→限流→会话→Agent→持久化→回复。所有渠道共用 | 渠道差异关在 `ChannelAdapter` 里 |
| `src/gateway/adapters/telegram.ts` | Telegram 渠道适配器（`ChannelAdapter`） | 每次请求构造，含 `detectLanguage` |
| `src/gateway/adapters/rest.ts` | REST API 渠道适配器（`ChannelAdapter`） | — |
| `src/gateway/rate-limiter.ts` | 限流（基于 KV 滑动窗口） | — |
| `src/session-store/trim-history.ts` | 按完整回合截断会话历史（原 session.ts 搬出） | 截断逻辑独立，无 session 依赖 |
| `src/router/` | 分层模型路由：`classifier.ts`（启发式复杂度判定）、`router-llm.ts`（`RouterLLM` 实现 `ILLMProvider`） | 对 agent.ts 透明；规则：宁多花钱不降质量 |
| `src/tools/` | 工具系统：`interface.ts`(Tool 接口+Registry)、`index.ts`(注册)、`fuel-tools.ts`、`vehicle-tools.ts` 等 | **新增能力的主战场**，见 §5；工具 `execute` 接受 `lang` 参数 |
| `src/llm-transport.ts` | 双 provider 底层：callDeepSeek / callAnthropic / 消息格式互转 / 重试 | 两条路径都要测；fallback 触发条件见注释 |
| `src/database.ts` | D1 数据访问层（纯 SQL，无业务逻辑） | 业务计算放 `src/tools/`，这里只做 CRUD |
| `src/types.ts` | 全局类型：`Env`、`Message`、工具/LLM 接口、`FuelRecord`、`Vehicle` | 改 Env 要同步 `wrangler.toml` 和 `test/utils.ts` |
| `src/i18n/` | 国际化：`zh.ts`/`en.ts` 字典、`t()` 翻译、`fmtNumber/fmtKm/fmtCost`、`getLang/setLang` | 新增用户文字必须进字典；支持 `{0}` 占位参数 |
| `src/prompts.ts` | 系统提示词：`buildSystemPrompt(lang)` 中英双语 | 改提示词要同步更新两个语言版本 |
| `src/scheduled.ts` | Cron 定时任务：到期提醒扫描 + 推送 + 自动续期 | 推送文案目前默认中文（cron 无用户上下文） |
| `src/stt.ts` | 语音转文字：Cloudflare Workers AI Whisper | `language` 参数跟随用户语言偏好 |
| `src/format.ts` | Markdown → 纯文本清洗 | Telegram 回复前调用 |
| `docs/schema.sql` | D1 建表脚本 | 改 schema 必须走迁移流程，见 [`docs/engineering/data-model.md`](docs/engineering/data-model.md) |
| `test/*.test.ts` | 单元/集成测试（vitest + workers pool） | 新功能必须带测试 |
| `test/utils.ts` | 测试用 `initDB`/`clearDB`/`makeEnv` | 改 schema 时这里的建表语句要同步 |
| `scripts/seed-fuel.ts` | 历史数据导入脚本 | — |
| `scripts/ingest-knowledge.ts` | 知识库离线入库：OCR → 清洗 → 分块 → JSON+SQL | 需装 poppler（winget install Poppler） |
| `scripts/populate-vectorize.ts` | chunks → embedding → Vectorize 索引 | 幂等，利用 wrangler OAuth |
| `scripts/test-knowledge.ts` | 离线评测知识库召回质量 | 本地余弦相似度 |
| `src/routes/api.ts` | Dashboard REST API 路由 | 所有端点 token 鉴权 |
| `src/routes/dashboard-html.ts` | Dashboard 前端 HTML（Chart.js + 分页 + 双语） | 图表/布局在此改 |
| `src/knowledge/embed.ts` | Workers AI bge-m3 embedding 封装 | 输出 1024 维向量 |
| `src/tools/knowledge-tools.ts` | `search_knowledge` 工具：RAG 检索入口 | 不直接调，由 Agent 调度 |

数据流一句话：`Telegram → index.ts(鉴权) → bootstrap(Env) → pipeline.ts(语言检测→限流→会话→agent) → agent.ts(runAgentLoop) → ILLMProvider.chat() ⇄ tools/(lang) → database.ts(D1) / knowledge(Vectorize+D1) → pipeline.ts(持久化→回复)`。

---

## 5. 如何新增一个功能（Agent 工作流）

绝大多数功能扩展都遵循同一套路——**加工具**，而不是改循环。

1. **先有 spec**：在 [`docs/specs/`](docs/specs/) 找到或创建该功能的规格（见 [`docs/specs/README.md`](docs/specs/README.md)）。
2. **（如需）改数据模型**：按 [`docs/engineering/data-model.md`](docs/engineering/data-model.md) 写**只加不删**的迁移；同步更新 `docs/schema.sql` 和 `test/utils.ts` 的建表语句。
3. **数据访问层**：在 `src/database.ts` 加纯 SQL 函数。
4. **定义工具**：在 `src/tools/` 创建或扩展工具类（实现 `Tool` 接口），在 `src/tools/index.ts` 注册。输出文案用 `t('key', lang, ...args)` 支持双语。
5. **接入 prompt**：如有必要，在 `src/agent.ts` 的 `buildSystemPrompt()` 增加该工具的使用规则（保持精简，描述放工具 `description` 里）。
6. **写测试**：`test/tools.test.ts`（工具逻辑）、必要时 `test/database.test.ts`。LLM 相关用 mock，不打真实 API。
7. **门禁**：`npm run type-check && npm test` 全绿。
8. **更新文档**：勾掉 `tasks.md`、必要时更新本文件 §4 表格与架构文档。

> 详细范式与工具契约规范见 [`docs/engineering/agent-design.md`](docs/engineering/agent-design.md)。

---

## 6. 代码约定（匹配现有风格）

- **语言/严格度**：TypeScript，`strict: true`。不引入 `any`（必要时 `unknown` + 收窄）。
- **模块**：ESM，命名导出为主；`src/index.ts` 默认导出 Workers handler。
- **命名**：函数/变量 `camelCase`，类型/接口 `PascalCase`，SQL 列名 `snake_case`（与 DB 一致）。
- **错误处理**：工具执行失败要 `try/catch` 并返回**人类可读的中文错误字符串**给 LLM，不要让异常冒泡中断 Loop（参考 `agent.ts` 现有写法）。
- **用户可见文案**：中文，简洁，沿用现有 emoji 风格（✅ ⛽ 📊 🕐）。
- **日志**：`console.log('[模块] ...')` 前缀化（如 `[tool]`、`[llm]`、`[worker]`），Workers 会收集到 Logpush。
- **注释**：解释"为什么"，与现有密度一致；不写废话注释。
- 详细规范见 [`docs/process/coding-standards.md`](docs/process/coding-standards.md)。

---

## 7. 约束与护栏（务必遵守）

- **Workers 执行限制**：单请求有 wall-time 上限。Agent Loop 用 `MAX_ROUNDS` 兜底，**不要**做长耗时同步计算或大循环。
- **不引入重依赖**：当前生产依赖只有 `grammy`。新增 npm 包前先确认能在 Workers 运行时（无 Node fs/net 完整 API，`nodejs_compat` 有限）跑通，并在 PR 说明理由。
- **不擅自迁移基础设施**：留在 Cloudflare 生态（Workers/D1/KV/Cron/Pages）。换存储/换 provider 属于架构决策，要先写 ADR（见 [`docs/engineering/adr/`](docs/engineering/adr/)）。
- **Schema 向上兼容**：只加列/加表，不删不改类型，保护历史数据（见 [`docs/engineering/data-model.md`](docs/engineering/data-model.md)）。
- **隐私与权限**：默认单用户（`ALLOWED_CHAT_ID` 白名单）。任何放开多用户的改动必须先过 [`docs/engineering/security.md`](docs/engineering/security.md) 的数据隔离设计。
- **不做的事**：不删用户数据、不改 git 历史、未经要求不 `git push`、不动 `wrangler.toml` 里的 `database_id`/`kv id`。

---

## 8. 测试要点

- 框架：`vitest` + `@cloudflare/vitest-pool-workers`（真实 Miniflare 环境，含 D1/KV）。
- LLM **必须 mock**，不打真实 DeepSeek/Anthropic（成本 + flaky）。
- 涉及 DB 的测试用 `test/utils.ts` 的 `initDB`/`clearDB` 隔离。
- 新功能 = 新测试。改 bug = 先加复现测试。
- 完整策略见 [`docs/engineering/testing-strategy.md`](docs/engineering/testing-strategy.md)。

---

## 9. 文档导航

| 你想做的事 | 去看 |
|-----------|------|
| 理解产品要什么 | [`docs/PRD.md`](docs/PRD.md) · [`docs/product/`](docs/product/) |
| 理解系统怎么搭的 | [`docs/engineering/architecture.md`](docs/engineering/architecture.md) |
| 理解 Agent/工具/LLM 设计 | [`docs/engineering/agent-design.md`](docs/engineering/agent-design.md) |
| 动数据库 | [`docs/engineering/data-model.md`](docs/engineering/data-model.md) |
| 开发一个新功能 | [`docs/specs/README.md`](docs/specs/README.md) → 对应 spec |
| 了解为什么这么选型 | [`docs/engineering/adr/`](docs/engineering/adr/) |
| 提交/PR 规范 | [`docs/process/contributing.md`](docs/process/contributing.md) |
| 判断任务是否完成 | [`docs/process/definition-of-done.md`](docs/process/definition-of-done.md) |

---

_本手册随代码演进。当你改动了影响上述任何约定的代码，请同步更新本文件。_
