# 需求：质量加固

> 规格 006 · 状态：✔️ 已实现（A/B 待部署；C 离线工具；D 用户动作） · 阶段：Phase 2（加固） · 优先级：P2
> 关联：[design.md](design.md) · [tasks.md](tasks.md) · [metrics](../../product/metrics.md) · [testing-strategy](../../engineering/testing-strategy.md)

一批已上线功能后的稳定性/可观测性加固，三个独立子项合并为一个 spec。

## A. 指标埋点

### 问题
[metrics.md](../../product/metrics.md) 定义了延迟/准确率等指标，但线上无结构化埋点，无法观测。

### 用户故事 / AC
- **US-A** 作为维护者，我想在日志里看到每次交互的端到端延迟与成败，以便观测 P50/P95 与异常。
- **AC-A1** 每次用户交互结束，输出一条 `[metric]` 日志，含延迟（ms）与状态（ok/error）。
- **AC-A2** 不影响正常回复；埋点失败不阻断主流程。

## B. 提醒自动续期

### 问题
里程提醒是**一次性**的（spec 003 明确"循环留待下一迭代"）。"机油每 3000 公里"触发后不会自动续，用户得手动重设。

### 用户故事 / AC
- **US-B** 作为骑手，我设"机油每 3000 公里提醒"，希望每次触发后自动续到下一个 3000 公里，无需重设。
- **AC-B1** Given 里程提醒带间隔 `interval_km`，When 触发推送，Then 自动新建下一条提醒，目标里程 = 本次目标 + interval_km。
- **AC-B2** 推送消息提示已自动续期及下次里程。
- **AC-B3** 绝对目标里程提醒（无 interval_km）触发后**不续期**（一次性）。
- **AC-B4** 日期提醒触发后**不续期**（本期不做日期循环）。

## C. LLM 评测集

### 问题
system prompt 已有 15 条规则 + ~17 个工具，"自然语言→正确工具/参数"的解析准确率随复杂度上升有下降风险，但无评测手段（单测把 LLM mock 掉了）。

### 用户故事 / AC
- **US-C** 作为维护者，我想用一组真实风格输入离线评测模型选对工具、抽对参数的准确率，以便回归与守住 [解析准确率>95%](../../product/metrics.md)。
- **AC-C1** 有 `npm run eval`，对用例集逐条调用真实模型，校验工具名（及关键参数），输出通过率。
- **AC-C2** 评测**不进 CI 门禁**（需真实 key、有成本、有不确定性），独立运行。
- **AC-C3** 用例覆盖各功能：记录、查询、多车指代、维保、提醒、纠错、改名。

## D. 容灾（用户动作）

- 设置 `ANTHROPIC_API_KEY`，开启 DeepSeek 故障时的 Claude 自动 fallback（[ADR-0003](../../engineering/adr/0003-deepseek-primary-claude-fallback.md)）。本 spec 仅提供指引，不含代码。

## 范围
**In Scope**：A/B/C 三项代码 + D 指引。
**Out of Scope**：日期提醒循环；APM/外部监控平台（保持零成本，[observability-ops](../../engineering/observability-ops.md)）。
