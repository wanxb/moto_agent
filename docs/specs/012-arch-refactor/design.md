# 设计：架构重构 — 请求路径统一 + 遗留代码清理

> 规格 012 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[architecture](../../engineering/architecture.md) · [agent-design](../../engineering/agent-design.md)

## 1. 方案概述

将 Telegram Bot 入口从 `session.ts` 直接调 `agentLoop` 改为走 `pipeline.ts` 编排管道，使所有请求统一经 `bootstrap → pipeline → runAgentLoop(ILLMProvider)`。

```
Before:
Telegram request → index.ts → session.ts:runAgent → agentLoop → callLLM()
REST API request → index.ts → bootstrap → pipeline → runAgentLoop(llm)

After (统一):
Telegram request → index.ts → bootstrap → pipeline → runAgentLoop(llm)
REST API request → index.ts → bootstrap → pipeline → runAgentLoop(llm)
                         ↑ 同一 App 实例，同一编排路径
```

key insight：需要新增的只有 `TelegramAdapter`（~60 行包装代码），其余全是删除或搬移。

## 2. 数据模型变更

无。纯代码重构，不涉及数据库 schema。

## 3. 工具契约变更

无。Agent Loop 内的工具注册逻辑不变。

## 4. Prompt 影响

无。System prompt 内容不变。

## 5. 数据访问层

无。`trimHistory` 从 `session.ts` 搬到独立文件，逻辑不变。

## 6. 流程 / 时序

### 6.1 Telegram 文字消息处理流程（重构后）

```
Telegram webhook POST
  ↓
index.ts: fetch()
  → webhook 鉴权（不变）
  → createBot().on('message:text')
       ↓
    TelegramAdapter(ctx, env)       ← 新增：包装 ctx
      ↓
    app.run(adapter, { text })
      ↓
    pipeline.ts: runPipeline(adapter, raw, ctx)
      ├─ 1. adapter.extractUser()   → chatId
      ├─ 2. rateLimit               → 限流
      ├─ 3. adapter.detectLanguage? → lang（新增可选步骤）
      ├─ 4. adapter.extractText()   → 消息文本
      ├─ 5. session.get(chatId)     → 历史消息
      ├─ 6. agent(history, db)      → runAgentLoop(llm, tools, registry, db, lang)
      ├─ 7. session.set(trimmed)    → 写回 KV
      ├─ 8. adapter.reply(reply)    → ctx.reply
      └─ 9. [metric] 日志
```

### 6.2 语言检测流程

```
TelegramAdapter.detectLanguage():
  getLang(SESSION_KV, chatId)       → 已有语言偏好？
  ├─ 有 → 返回
  └─ 无
       ctx.from?.language_code      → Telegram 客户端语言
       ├─ 有 → detectLang() + setLang() → 返回
       └─ 无 → 默认 'zh'
```

`pipeline.ts` 中新增一个可选步骤——如果 adapter 实现了 `detectLanguage`，就调用它把 lang 传入 session 和 agent。

### 6.3 语音消息流程（重构后）

```
voice message
  ↓
index.ts bot.on('message:voice')
  → 下载音频文件（不变）
  → transcribe(bytes, env, lang)    → 文字（不变）
  → 回复 "听到你说：xxx"（不变）
       ↓
    之后与文字消息走同一条 pipeline：
    adapter = new TelegramAdapter(ctx, env)
    app.run(adapter, { text: sttResult })
```

### 6.4 命令流程（重构后）

```
/last 命令
  ↓
index.ts bot.command('last')
  → 不再直接调 runAgent
  → adapter = new TelegramAdapter(ctx, env)
  → app.run(adapter, { text: '获取最近一次加油记录' })
```

`/start`、`/help`、`/lang`、`/dashboard` 同理。
`/lang` 命令的特殊性：它需要先切换语言再走 pipeline（或直接在 handler 里做完切换后走 pipeline 做后续响应）。

## 7. 新增/修改/删除文件清单

### 7.1 新增文件

| 文件 | 职责 | 行数 |
|------|------|------|
| `src/gateway/adapters/telegram.ts` | 包装 grammy Context 为 ChannelAdapter，含检测语言 | ~60 |
| `src/session-store/trim-history.ts` | trimHistory 纯函数迁移至此 | ~40 |

### 7.2 修改文件

| 文件 | 改动 | 行数 |
|------|------|------|
| `src/gateway/pipeline.ts` | 加可选 detectLanguage 步骤 + metrics 日志 + 统一错误兜底 | ~25 |
| `src/gateway/pipeline.ts` | AgentRunner 签名加 `lang` 参数 | ~5 |
| `src/index.ts` | Telegram handlers 走 app.run；commands 走 pipeline | ~35 |
| `scripts/eval.ts` | 旧 callLLM → callDeepSeek 或 DeepSeekLLM | ~5 |
| `test/pipeline.test.ts` | 增 TelegramAdapter 测试 + 语言检测测试 | ~25 |
| `test/trim.test.ts` | import 路径改到 session-store | ~1 |

### 7.3 删除文件及函数

| 文件/函数 | 理由 | 行数 |
|----------|------|------|
| `src/session.ts`（整文件） | 职责被 pipeline + TelegramAdapter + trim-history 吸收 | -65 |
| `src/agent.ts` 中 `agentLoop` | 旧签名，全部调用方已迁至 `runAgentLoop` | -35 |
| `src/llm-transport.ts` 中 `callLLM` | 旧聚合函数，全部使用方已改用底层函数或 ILLMProvider | -20 |
| `test/session.test.ts`（整文件） | session.ts 已删，测试内容被 pipeline.test.ts 覆盖 | -148 |

## 8. 边界与错误处理

- **bootstrap 调用频率**：每次 webhook 请求调用一次 `bootstrap(env)` 无 IO 开销，可接受。如果冷启动性能敏感，可在 fetch 外层创建惰性单例。
- **语音消息出错**：STT 失败时"没听清请重试"——不进入 pipeline，与当前行为一致。
- **命令 `/lang`**：需要在 pipeline 之外先切换语言偏好。保持 handler 内 `setLang` 逻辑不变，之后可以不进 pipeline。
- **REST API 的语言检测**：目前无语言检测逻辑。pipeline 的 detectLanguage 步骤在 adapter 未实现时为 no-op，保持现有行为不变。

## 9. 风险与权衡

| 风险 | 缓解 |
|------|------|
| TelegramAdapter 构造时 grammy Context 的部分字段可能已异步消费 | 只使用 `ctx.chat.id`、`ctx.reply`、`ctx.from?.language_code`，均为 grammy webhook 模式安全字段 |
| `app.run` 返回值语义变化（REST 返回文本，Telegram 不返回）| pipeline 统一返回 string，Telegram 侧通过 adapter.reply 发消息，不依赖返回值 |
| 删除 `agentLoop` 可能影响 eval 脚本和其他调用方 | `scripts/eval.ts` 只做单次 LLM 调用，不需要 agent loop，改为 `callDeepSeek` 直接调用 |
| `trimHistory` 搬移后 import 链断掉 | 同步更新 `pipeline.ts` 的 import，`trim.test.ts` 的 import 路径 |

## 10. 测试要点

- `TelegramAdapter.extractUser` / `extractText` / `reply` 单元测试（mock ctx）
- `TelegramAdapter.detectLanguage` 单元测试（mock KV + ctx.language_code）
- pipeline 语言检测步骤集成测试（adapter 实现 detectLanguage 和未实现两种情况）
- 回归：现有 `pipeline.test.ts` 所有测试保持通过
- 回归：`agent.test.ts` 中 `runAgentLoop` 的测试保持通过（只删除旧 `agentLoop` 测试 case）
- `trimHistory` 搬移后 `trim.test.ts` 全绿
- `npm run type-check && npm test` 全绿
