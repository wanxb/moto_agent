# 任务：架构重构 — 请求路径统一 + 遗留代码清理

> 规格 012 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。每条任务可独立验证。

---

## 任务清单

### Phase 1：准备 — 搬移无依赖的小模块

- [ ] **T1 `trimHistory` 搬移到独立模块**
  - 新建 `src/session-store/trim-history.ts`，内容从 `session.ts` 搬出
  - `session.ts` 的导出改为 `export { trimHistory } from '../session-store/trim-history'`（过渡）
  - `trim.test.ts` import 路径改为 `'../src/session-store/trim-history'`
  - 验证：`npm test` 通过，`trim.test.ts` 覆盖不降

### Phase 2：核心 — Telegram 走 pipeline

- [ ] **T2 创建 `src/gateway/adapters/telegram.ts`**
  - 实现 `ChannelAdapter` 接口：`extractUser`、`extractText`、`reply`
  - 实现 `detectLanguage` 方法（读取 KV 语言偏好 → fallback 到 `ctx.language_code` → 默认 'zh'）
  - 验证：`npm run type-check` 通过

- [ ] **T3 `pipeline.ts` 增加语言检测 + metrics + 错误兜底**
  - `PipelineContext` 增加可选 `agentLang` 字段
  - pipeline 步骤中：如果 adapter 有 `detectLanguage()`，在 extractText 后执行，传入 agent
  - `AgentRunner` 签名改为 `(messages, db, lang?) => Promise<string>`（lang 默认 'zh'）
  - pipeline 主逻辑加 `try/catch`，catch 里回复统一错误
  - pipeline 出口前加 `console.log('[metric] latency_ms=...')`
  - 验证：`npm run type-check` 通过

- [ ] **T4 `index.ts` Telegram Bot 入口改走 pipeline**
  - `message:text` handler：构造 `TelegramAdapter` → `app.run(adapter, { text })`
  - `message:voice` handler：STT 逻辑不变，转文字后走 `app.run(adapter, { text: sttResult })`（复用 adapter）
  - `command('last')` 改为走 pipeline，传入文本 `'获取最近一次加油记录'`
  - `command('stats')` 改为走 pipeline，传入文本 `'查询本月油耗统计'`
  - `command('start')` / `command('help')` 走 pipeline（或保持直接回复——简单文本无工具调用，为减少一次 LLM 调用可以保持直接回复）
  - `command('lang')` handler 不变（语言切换逻辑在 handler 内，不进 pipeline）
  - `command('dashboard')` handler 不变（无 LLM 调用）
  - 验证：`npm run type-check` 通过

- [ ] **T5 `bootstrap.ts` 兼容性调整**
  - `AgentRunner` 签名同步修改 `(messages, db, lang?)`，传入 lang
  - 验证：`npm run type-check` 通过

### Phase 3：清理 — 删旧代码

- [ ] **T6 删除旧 `agentLoop`（`src/agent.ts`）**
  - 只保留 `runAgentLoop`，删除 `agentLoop` 函数及其内联的 fallback 逻辑
  - `buildSystemPrompt` 导出保留（被 prompts.ts / eval.ts 使用）
  - `test/agent.test.ts`：删除测试旧 `agentLoop` 的 case，保留测试 `runAgentLoop` 的 case
  - 验证：`npm run type-check && npm test` 通过

- [ ] **T7 删除旧 `callLLM`（`src/llm-transport.ts`）**
  - 删除 `callLLM` 函数，保留 `callDeepSeek`、`callAnthropic`、`isRetryable`、`sleep`、`toAnthropicMessages`
  - `test/llm.test.ts`：删除测 `callLLM` 的 case，改为直接测 `callDeepSeek`（或跳过该测试文件留到模型迁移 spec 时重构）
  - `scripts/eval.ts`：将 `callLLM()` 调用改为 `callDeepSeek()` 直接调用
  - 验证：`npm run type-check && npm test` 通过

- [ ] **T8 删除 `src/session.ts` + `test/session.test.ts`**
  - 确认最后的使用者：`index.ts` import 的 `runAgent` 已移除；`pipeline.ts` import 的 `trimHistory` 已改为 session-store
  - 删除 `src/session.ts`
  - 删除 `test/session.test.ts`
  - 验证：`npm run type-check && npm test` 通过

### Phase 4：验证

- [ ] **T9 全量门禁检查 + 文档更新**
  - `npm run type-check && npm test` 全绿
  - 确认无 `session.ts`、`agentLoop`、`callLLM` 的 import 残留
  - 更新 `docs/specs/README.md` 索引中本 spec 状态为 "✔️ Done"
  - 更新 `CLAUDE.md` §4 代码地图：`src/session.ts` → 标记已移除，`src/gateway/` 增加说明

---

## 验收（Definition of Done）

- [ ] 所有 `requirements.md` 验收标准（AC1–AC8）满足。
- [ ] `npm run type-check && npm test` 全绿。
- [ ] 受影响文档已更新（specs 索引 + CLAUDE.md）。
- [ ] 无 secret 泄露，遵守安全清单。
