# 需求：分层模型路由 — 简单请求走便宜模型，复杂请求走强模型

> 规格 013 · 状态：📝 草稿 · 阶段：Phase 2（加固） · 优先级：P1
> 关联：[roadmap](../../product/roadmap.md) · [design.md](design.md) · [tasks.md](tasks.md) · [012 路径统一](../012-arch-refactor/)

## 1. 问题陈述

当前所有 LLM 请求都使用同一个模型（DeepSeek V4 Flash 或 Claude Sonnet），但实际请求的复杂度差异巨大：

| 请求类型 | 占比估测 | 实际需要的模型能力 |
|---------|---------|-----------------|
| 简单问候 / 确认 / 单步查询 | ~70% | 极低成本模型即可 |
| 单一工具调用（记录加油、查油耗） | ~20% | 中等，V4 Flash 刚好 |
| 复合意图 / 故障排查 / 多步推理 | ~10% | 强模型，V4 Pro / Claude Sonnet |

**用同一个模型处理所有请求的代价**：
- 全部走强模型：70% 的简单请求多花 3-12× 的钱
- 全部走便宜模型：10% 的复杂请求回答质量低

## 2. 用户故事

- 作为**运营者**，我想**简单请求走便宜的 DeepSeek V4 Flash**，以便**在保证体验的前提下将 LLM 成本降低 50%+**。
- 作为**用户**，当我问**"发动机异响怎么办"这类复杂问题时**，我希望**得到更精准的回答**，即使多等一两秒。
- 作为**开发者**，我想**模型路由对 Agent Loop 透明**，以便**切换路由策略时不改 agent.ts 一行代码**。

## 3. 范围

**In Scope**

- `classifyComplexity()` 纯启发式规则函数（零 LLM 调用，纯正则匹配）
- `RouterLLM` 类实现 `ILLMProvider` 接口，按复杂度分派到不同 `FallbackLLM`
- 简单层：`FallbackLLM(V4 Flash ×3 → V4 Pro ×1)`
- 复杂层：`FallbackLLM(V4 Pro ×3 → V4 Flash ×1)`
- `bootstrap.ts` 中组装 RouterLLM 并注入
- `classifyComplexity()` 的单元测试覆盖各种输入分类

**Out of Scope（本期不做）**

- 动态按轮次升级（先 Flash 试，不行切 Pro）——V4 Flash 已自带思考模式，可后续优化
- 用户级别的模型偏好设置（如"我总是想用最好的模型"）
- A/B 测试框架
- 跨供应商路由（V4 → Claude）——作为 FallbackLLM 内置能力保留，不做路由层策略

## 4. 验收标准

- **AC1** Given 用户输入"你好"，When `classifyComplexity` 执行，Then 返回 `'simple'`。
- **AC2** Given 用户输入"帮我看下发动机故障灯亮了怎么回事"，When `classifyComplexity` 执行，Then 返回 `'complex'`。
- **AC3** Given 用户输入"加了10升98块"，When `classifyComplexity` 执行，Then 返回 `'simple'`（单意图加简单查询）。
- **AC4** Given `RouterLLM.chat()` 被调用，When 复杂度为 `'simple'`，Then 请求路由到 simple provider。
- **AC5** Given `RouterLLM.chat()` 被调用，When 复杂度为 `'complex'`，Then 请求路由到 complex provider。
- **AC6** Given `RouterLLM` 的 simple provider 三次重试全部失败，When 继续请求，Then fallback 到 complex provider（跨层自愈）。
- **AC7** Given 所有现有测试，When 本 spec 变更完成，Then `npm run type-check && npm test` 全绿。
- **AC8** `RouterLLM` 实现 `ILLMProvider` 接口，`agent.ts` 零改动。

## 5. 交互示例

（用户侧无感知——同一套回复，背后走不同模型）

```
用户：你好
Bot：你好！有什么可以帮你？  ← 背后走 V4 Flash，成本 ~$0.0001

用户：发动机异响是怎么回事
Bot：根据维修手册，发动机异响可能的原因有：
1. 气门间隙过大 → 需调整
2. 链条松动 → 需紧固
3. 机油不足 → 检查油位
建议去维修站检查。
  ← 背后走 V4 Pro，成本 ~$0.002
```

## 6. 依赖与假设

- **硬依赖**：Spec 012 路径统一必须先完成，否则 Telegram 请求不经过 `ILLMProvider`，RouterLLM 不生效。
- 假设：`classifyComplexity` 规则不需要 100% 准确。**宁可多花钱（simple 判为 complex）也不能降低质量（complex 判为 simple）**。阈值偏高。
- 假设：V4 Pro 的能力显著优于 V4 Flash。如果后续观测到 Pro 的提升对复杂场景不明显，可降低路由阈值或改用跨供应商路由。

## 7. 开放问题

| 问题 | 影响 | 待决 |
|------|------|------|
| classifyComplexity 是否需要在运行时收集误判率？| 低——可通过日志中的 model 选择观察比例 | 首次上线不加，后续可加埋点 |
| 是否要加 metrics（simple/complex 调用计数）？| 低——console.log 可观察，后续可加正式监控 | 这次不做 |
