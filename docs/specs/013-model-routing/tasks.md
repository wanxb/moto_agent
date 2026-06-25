# 任务：分层模型路由 — 简单请求走便宜模型，复杂请求走强模型

> 规格 013 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。每条任务可独立验证。
> **前置依赖**：Spec 012 路径统一必须完成（否则 Telegram 请求不走 ILLMProvider，RouterLLM 不生效）。

---

## 任务清单

> 顺序：独立模块 → 组装 → 测试 → 文档

- [ ] **T1 实现 `classifyComplexity()`**
  - 新建 `src/router/classifier.ts`
  - 导出 `type Complexity = 'simple' | 'complex'` 和 `classifyComplexity(messages: Message[]): Complexity`
  - 覆盖 rules：简单问候、极短文本、故障排查、复合意图、计算统计
  - 空消息保护：返回 `'complex'`
  - 验证：`npm run type-check` 通过

- [ ] **T2 实现 `RouterLLM`**
  - 新建 `src/router/router-llm.ts`
  - 实现 `ILLMProvider` 接口：构造接收 `simple: ILLMProvider` + `complex: ILLMProvider`
  - `chat()` 方法：调用 `classifyComplexity` → 按 tier 分派 → simple 失败时自动升级 complex
  - 新建 `src/router/index.ts` barrel export
  - 验证：`npm run type-check` 通过

- [ ] **T3 `bootstrap.ts` 组装 RouterLLM**
  - 创建 2 个 `DeepSeekLLM` 实例（`deepseek-v4-flash` + `deepseek-v4-pro`）
  - 创建 2 个 `FallbackLLM` 实例（simple + complex 层）
  - 创建 `RouterLLM` 注入 `App.llm`
  - 注意：Spec 014 必须先完成（`DeepSeekLLM` 构造函数支持 `model` 参数）
  - 验证：`npm run type-check` 通过

- [ ] **T4 测试**
  - 新建 `test/classifier.test.ts`：
    - 空消息 → `'complex'`
    - 问候类 → `'simple'`
    - 单意图加油/查油耗 → `'simple'`
    - 复合意图（"加油并查保养"）→ `'complex'`
    - 故障排查（"发动机异响"）→ `'complex'`
    - 统计对比 → `'complex'`
  - 新建 `test/router-llm.test.ts`：
    - simple 消息 → 调用 simple provider
    - complex 消息 → 调用 complex provider
    - simple provider 失败 → 自动升级 complex
    - 两个 provider 都失败 → 异常冒泡
  - 验证：`npm run type-check && npm test` 全绿

- [ ] **T5 文档更新**
  - `docs/specs/README.md` 索引中本 spec 状态标记为 "✔️ Done"
  - `CLAUDE.md` §4 代码地图新增 `src/router/` 说明

---

## 验收（Definition of Done）

- [ ] 所有 `requirements.md` 验收标准（AC1–AC8）满足。
- [ ] `npm run type-check && npm test` 全绿。
- [ ] `agent.ts` 零改动（确认 AC8）。
- [ ] 受影响文档已更新。
