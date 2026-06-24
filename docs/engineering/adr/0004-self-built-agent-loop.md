# ADR-0004：自实现 Agent Loop 而非引入框架

**状态**：✅ Accepted ·  **日期**：MVP 期

## 背景

需要一个 Agent 编排层（LLM 决策 → 调工具 → 回灌 → 再决策）。可选成熟框架（LangChain/LangGraph 等）或自实现。

## 决策

**自实现轻量 Agent Loop**（参考教程 S01–S04，TypeScript 移植）：`while` 循环 + `stop_reason` 判断 + 工具调度表。

## 理由 / 后果

**正面**：
- 轻量可控，代码量小、易读、易测，完全贴合 Cloudflare Workers 无状态 + 短请求模型。
- 无重依赖（生产依赖仅 `grammy`），契合 Workers 运行时限制（[ADR-0002](0002-cloudflare-workers-runtime.md)）。
- 能精确控制轮数护栏（`MAX_ROUNDS`）、错误处理、消息格式——这些恰是 Workers 环境的关键约束点。
- 升级路径清晰：需要时按教程逐步引入 S06 子智能体、S08 压缩、S09 记忆等。

**负面 / 代价**：
- 不享受框架的现成能力（记忆、多智能体、追踪）——但 MVP/Phase 2 明确不需要（见 [`../agent-design.md`](../agent-design.md) §6）。
- 需自己维护 Loop 与格式转换逻辑。

## 边界（何时重新评估）

当单 Loop 遇到明显瓶颈（需异步子任务、上下文溢出、多智能体协作）再按需引入对应机制，而非提前上框架。届时写新 ADR。

## 备选方案

- **LangChain/LangGraph**：功能全但偏重、Workers 兼容性与体积存疑、对简单场景过度。否决（YAGNI + 运行时约束）。

## 关联

[`../agent-design.md`](../agent-design.md) · [`../../PRD.md`](../../PRD.md) §5.3。
