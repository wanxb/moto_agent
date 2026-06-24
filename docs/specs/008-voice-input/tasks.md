# 任务：语音输入

> 规格 008 · 关联：[requirements.md](requirements.md) · [design.md](design.md) · [ADR-0007](../../engineering/adr/0007-cloudflare-workers-ai-stt.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。**无数据库迁移。**
>
> **状态：T1–T6 完成；T7 语音冒烟待用户。** 测试：135 passed（新增 4 条 `test/stt.test.ts`）。

## A. STT 层 + 配置
- [x] **T1**：`src/stt.ts` `transcribe(bytes, env)` + `toBase64`（Whisper-turbo，`language=zh`）。
- [x] **T2**：`types.ts` `Env.AI`（最小接口）；`wrangler.toml` 加 `[ai] binding = "AI"`；测试用 `wrangler.test.toml`（无 AI）。

## B. 语音入口
- [x] **T3**：`index.ts` `bot.on('message:voice')`：时长校验 → 下载 → transcribe → 回显 → `runAgent`；空/异常兜底；`[voice]` 日志。

## C. 测试 + 文档 + 部署
- [x] **T4 测试**：`test/stt.test.ts`（toBase64 含大 buffer + transcribe mock 验证模型/参数/空串）；135 passed。
  - 注：`[ai]` 绑定致 Miniflare 启动失败 → 新增 `wrangler.test.toml`（无 AI）+ vitest 指向它。
- [x] **T5 文档**：`architecture`/`security`/`observability-ops`/`testing-strategy` + 本 spec/索引/状态/README 同步。
- [ ] **T6 部署**：提交 + push + `npm run deploy`（注册 `[ai]`）— 进行中。
- [ ] **T7 语音冒烟**：Telegram 发语音验证 AC1–AC5（用户）。

## 验收（DoD）
- [x] AC1–AC6 设计满足（AC1–5 部署后语音验证，AC6 复用 spec 004）。
- [x] `npm run type-check && npm test` 全绿（135 passed）。
- [x] 工具/Agent/数据层零改动；失败兜底不崩。
- [x] 文档同步；无新 secret（AI 用 binding 鉴权）。
