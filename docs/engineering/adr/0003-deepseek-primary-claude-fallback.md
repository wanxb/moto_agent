# ADR-0003：DeepSeek 主 + Claude 备 + 自动 Fallback

**状态**：✅ Accepted ·  **日期**：MVP 期

## 背景

核心能力依赖 LLM 做自然语言解析与工具调用。需要：中文强、工具调用稳、成本低、可用性高。单一 provider 故障会导致整体不可用。

## 决策

**DeepSeek V3（`deepseek-chat`）为主，Claude Sonnet（`claude-sonnet-4-6`）为备，统一 `callLLM()` 接口，主故障时自动 fallback。**

## 理由 / 后果

**正面**：
- DeepSeek：中文能力强、工具调用稳定、成本极低（约 Claude 1/30），契合个人项目预算（[护栏 < $5/月](../../product/metrics.md)）。
- Claude 备用：DeepSeek 限流/故障时保 99%+ AI 可用性。
- 统一接口：上层（`agent.ts`）不感知具体模型，换/加 provider 不影响业务（模型层可替换原则）。

**负面 / 代价**：
- 需维护两套 API 格式互转（OpenAI ⇄ Anthropic），`llm.ts` 复杂度上升。
- **改 `llm.ts` 必须两条路径都测**（写入 [`../../../CLAUDE.md`](../../../CLAUDE.md) §2-4 铁律）。

## Fallback 规则

- 可重试：429、5xx → 指数退避重试 3 次。
- 不可重试：4xx → 立即抛出（fallback 救不了配置/请求错误）。
- 3 次耗尽 → 切 Anthropic。详见 [`../agent-design.md`](../agent-design.md) §4。

## 备选方案

- **单一 Claude**：可用性好但成本高 30 倍。否决（成本护栏）。
- **单一 DeepSeek**：成本最优但无容灾。否决（可用性）。
- **多模型负载均衡**：MVP 过度设计。否决（YAGNI）。

## 关联

[`../agent-design.md`](../agent-design.md) §4 · [`../../../PRD.md`](../../../PRD.md) §5.1、§5.3。
