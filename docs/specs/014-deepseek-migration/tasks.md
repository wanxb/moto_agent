# 任务：DeepSeek 模型迁移 — deepseek-chat → deepseek-v4-flash

> 规格 014 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。每条任务可独立验证。
> **截止时间**：2026/07/24 23:59（建议提前 1-2 周部署，留回滚窗口）

---

## 任务清单

> 顺序：config → 函数签变更 → provider 变更 → 测试 → 验证

- [ ] **T1 Config 常量变更**
  - `src/config.ts`：
    - `DEEPSEEK_MODEL` 改为 `'deepseek-v4-flash'`
    - 新增 `DEEPSEEK_MODEL_PRO = 'deepseek-v4-pro'`
  - 验证：`npm run type-check` 通过

- [ ] **T2 `callDeepSeek` 签名加 model 参数**
  - `src/llm-transport.ts`：
    - `callDeepSeek(messages, tools, apiKey, model?)` 第四个可选参数
    - body.model = `model ?? DEEPSEEK_MODEL`
  - 验证：不传 model 时行为与改前一致（走 config 默认）
  - 验证：传 model 时请求 body 使用该值

- [ ] **T3 `DeepSeekLLM` 构造函数加 model 参数**
  - `src/infra/deepseek-llm.ts`：
    - `constructor(apiKey, model?)` 第二个可选参数
    - `chat()` 中调用 `callDeepSeek(messages, tools, this.apiKey, this.model)`
  - 验证：不传 model 时使用 `DEEPSEEK_MODEL`（与改前行为一致）
  - 验证：`new DeepSeekLLM(key, 'deepseek-v4-pro')` 正确注入

- [ ] **T4 测试验证**
  - `test/llm.test.ts` 中确认 `callDeepSeek` 传递 model 参数的 case
  - 验证：`npm run type-check && npm test` 全绿

- [ ] **T5 本地冒烟测试**
  - 运行 `npm run dev`（wrangler dev 本地环境）
  - 通过 Telegram 或 curl 发送一条测试消息：`"加10升98块"`
  - 确认 Agent 正常工作，正确调用工具和生成回复
  - 检查 wrangler dev 日志中请求的 model 名是否切换新值

- [ ] **T6 文档更新**
  - `docs/specs/README.md` 索引中本 spec 状态标记为 "✔️ Done"
  - 如有需要更新 `CLAUDE.md` §4 中关于 `src/config.ts` 的说明

---

## 验收（Definition of Done）

- [ ] 所有 `requirements.md` 验收标准（AC1–AC6）满足。
- [ ] `npm run type-check && npm test` 全绿。
- [ ] `deploy` 到 staging 环境后冒烟通过。
- [ ] 受影响文档已更新。
