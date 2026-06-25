# 需求：架构重构 — 请求路径统一 + 遗留代码清理

> 规格 012 · 状态：📝 草稿 · 阶段：Phase 2（加固） · 优先级：P0
> 关联：[roadmap](../../product/roadmap.md) · [design.md](design.md) · [tasks.md](tasks.md)

## 1. 问题陈述

项目当前存在两条并行的请求处理路径，职责重叠且维护成本高：

```
路径一（旧 — session.ts）         路径二（新 — pipeline.ts + bootstrap.ts）
Telegram Bot 入口                  REST API 入口
→ session.ts: runAgent()           → bootstrap(env): 创建 App
  → agentLoop()                      → pipeline: runPipeline()
    → callLLM()  ← 硬编码              → runAgentLoop(llm, tools, ...)
                                         → llm.chat()  ← 多态注入
```

**两条路径的核心差异**：

| 维度 | 路径一（旧） | 路径二（新） |
|------|------------|------------|
| LLM 调用方式 | `callLLM()` 硬编码，不可替换 | `ILLMProvider` 多态注入 |
| 工具注入 | 隐式使用全局 `registry` | 显式注入 |
| 渠道适配 | Telegram 专属 | `ChannelAdapter` 接口，任意渠道 |
| 会话存储 | 硬编码 `SESSION_KV` | `ISessionStore` 接口 |
| 语言检测 | 内置在 `runAgent` 中 | 无 |

**后果**：
- 分层模型路由（RouterLLM）无法在 Telegram 路径生效
- 新增渠道时必须复制会话/语言/限流逻辑
- `callLLM` 作为历史包袱阻碍 `llm-transport.ts` 的清理
- `session.ts` 45% 的代码与 `pipeline.ts` 职责重叠

## 2. 用户故事

- 作为**开发者**，我想**所有请求走同一套编排管道**，以便**新增渠道时只需实现 ChannelAdapter，不复制会话/语言/限流逻辑**。
- 作为**运维者**，我想**删除 session.ts 和旧 agentLoop**，以便**降低代码复杂度，减少安全隐患**。
- 作为**架构演进者**，我想**所有请求统一走 ILLMProvider 接口**，以便**分层路由/故障注入等能力对所有入口生效**。

## 3. 范围

**In Scope**

- 创建 `TelegramAdapter`：将 grammy `Context` 包装为 `ChannelAdapter`
- `pipeline.ts` 增加语言检测步骤（可选，adapter 可提供 `detectLanguage`）
- `index.ts` 中 Telegram bot handlers（`message:text`, `message:voice`, commands）全部走 `app.run(adapter)`
- `trimHistory` 移到独立的 `src/session-store/trim-history.ts`
- `pipeline.ts` 增加 metrics 日志 + 通用错误兜底
- 删除 `src/session.ts`（整文件）
- 删除 `src/agent.ts` 中的旧 `agentLoop` 函数
- 删除 `src/llm-transport.ts` 中的旧 `callLLM` 聚合函数
- `scripts/eval.ts` 改用 `callDeepSeek` 直接调用
- 清理对应的测试文件（`session.test.ts`，重构 `agent.test.ts`、`llm.test.ts`）

**Out of Scope（本期不做）**

- 分层模型路由（RouterLLM）——会在本 spec 之后、作为下一 spec 引入
- DeepSeek 模型迁移（`deepseek-chat` → `v4-flash`）——会与本 spec 同步或稍后执行
- 知识库 RAG
- 多 Agent

## 4. 验收标准

- **AC1** Given 一条 Telegram 文字消息，When 经 webhook 进入，Then 回复正确且经过完整的 pipeline 编排（限流 → 会话 → agent → 持久化）。
- **AC2** Given 有会话历史的用户，When 发新消息，Then 旧历史被正确加载到 agent 上下文中。
- **AC3** Given 语言偏好已存储的 Telegram 用户，When 发消息，Then agent 使用对应语言回复。
- **AC4** Given agent 抛出异常，When 任何渠道处理中，Then 用户收到统一错误提示"出错了请重试"，且会话已保存。
- **AC5** Given `/last` 或 `/stats` 命令，When 用户执行，Then 像普通文字消息一样走 pipeline。
- **AC6** Given voice 消息，When 用户发送，Then 转文字后同一条 pipeline 处理。
- **AC7** Given 现有测试套件，When 本 spec 变更完成，Then `npm run type-check && npm test` 全绿。
- **AC8** `src/` 下无 `session.ts` 导出，无 `callLLM` 调用，无 `agentLoop` 导出。

## 5. 交互示例

（用户侧无感知——内部架构重构，Telegram 回复行为不变）

```
用户：加了10升98块
Bot：✅ 已记录加油！
```

## 6. 依赖与假设

- 依赖：现有 `pipeline.ts`、`bootstrap.ts`、`ILLMProvider`、`ChannelAdapter` 接口——都在运行中，无需重写。
- 假设：grammy `Context` 在 webhook 回调中可安全构造 `TelegramAdapter`。
- 假设：语音消息的 STT 逻辑（`index.ts` 现有）不变，只改 STT 后文字提交的路径。

## 7. 开放问题

| 问题 | 影响 | 待决 |
|------|------|------|
| `bootstrap(env)` 在每次 webhook 请求中调用是否有性能开销？ | 低——bootstrap 只做对象组合，无 I/O | 可在外层缓存 `App` 实例，但 Worker 冷启动后第一个请求本身就会有额外开销 |
| Telegram commands (`/start`, `/help`) 也走 pipeline 还是保留直接回复？ | 低——走 pipeline 更统一 | 建议也走 pipeline——它们会被 RouterLLM 判为 `simple`，走 V4 Flash 低成本处理 |
