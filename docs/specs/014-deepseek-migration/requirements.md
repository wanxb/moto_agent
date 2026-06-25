# 需求：DeepSeek 模型迁移 — deepseek-chat → deepseek-v4-flash

> 规格 014 · 状态：📝 草稿 · 阶段：Phase 2（加固） · 优先级：🔴 P0（截止 2026/07/24）
> 关联：[roadmap](../../product/roadmap.md) · [design.md](design.md) · [tasks.md](tasks.md) · [013 分层路由](../013-model-routing/)

## 1. 问题陈述

DeepSeek 官方将于 **2026/07/24 23:59** 弃用 `deepseek-chat` 和 `deepseek-reasoner` 两个模型名。

当前项目配置（`src/config.ts:10`）：

```typescript
export const DEEPSEEK_MODEL = 'deepseek-chat';
```

距弃用截止日期约 **1 个月**。不迁移将导致 Tokenizer 和接口行为变化（官方邮件提示：弃用后使用旧模型名可能返回错误或降级行为）。

### 新版模型定价对比

| 模型 | 输入 / M tokens | 输出 / M tokens | 支持工具调用 |
|------|---------------|----------------|-------------|
| **deepseek-chat（旧）** | $0.27 | $1.10 | ✅ |
| **deepseek-v4-flash（新）** | ¥1 ≈ **$0.14**（↓48%） | ¥2 ≈ **$0.28**（↓75%） | ✅ |
| **deepseek-v4-pro（新，更强）** | ¥3 ≈ **$0.42** | ¥6 ≈ **$0.84** | ✅ |

旧模型 $0.27/M → V4 Flash $0.14/M，降价 48%。且 V4 Flash 原生支持"思考/非思考"双模式，同一模型名即可覆盖原来 `deepseek-chat` + `deepseek-reasoner` 两个模型名的功能。

## 2. 用户故事

- 作为**运维者**，我想**在截止日前将模型名迁移到 deepseek-v4-flash**，以便**避免服务中断**。
- 作为**运营者**，我想**利用 V4 Flash 的更低价格**，以便**降低 48-75% 的 LLM 成本**。

## 3. 范围

**In Scope**

- `src/config.ts` 中 `DEEPSEEK_MODEL` 改为 `'deepseek-v4-flash'`
- 新增 `DEEPSEEK_MODEL_PRO = 'deepseek-v4-pro'` 配置项（为 Spec 013 分层路由准备）
- `callDeepSeek()` 签名增加可选 `model` 参数（不改时 fallback 到 `DEEPSEEK_MODEL`）
- `DeepSeekLLM` 构造函数增加 `model` 参数
- 在 staging 环境中做一次冒烟测试确认 V4 Flash 的 tool-calling 行为与旧版一致

**Out of Scope（本期不做）**

- 分层路由（Spec 013）——虽然本 spec 做好了 `v4-pro` 的配置和 `callDeepSeek` 的 model 参数准备，但不实际使用 Pro 模型
- Claude fallback 的逻辑变更

## 4. 验收标准

- **AC1** `DEEPSEEK_MODEL` 的值在 `src/config.ts` 中为 `'deepseek-v4-flash'`。
- **AC2** `callDeepSeek(messages, tools, apiKey)` 不传 model 时，使用 `DEEPSEEK_MODEL` 默认值。
- **AC3** `callDeepSeek(messages, tools, apiKey, 'deepseek-v4-pro')` 传 model 参数时，请求 body 中使用该值。
- **AC4** `DeepSeekLLM` 构造函数接受 `model?: string` 参数，默认使用 `DEEPSEEK_MODEL`。
- **AC5** `npm run type-check && npm test` 全绿。
- **AC6** 本地 `wrangler dev` 发送一条测试加油记录可正常处理。

## 5. 交互示例

（用户侧无感知——模型名变了，行为不变）

```
用户：加了10升98号
Bot：✅ 已记录加油！上次加油后行驶了 350km，油耗 2.86L/100km
```

## 6. 依赖与假设

- 假设：deepseek-v4-flash 的 tool-calling 行为与 deepseek-chat 兼容。基于官方文档，两者均为 OpenAI 兼容格式，`deepseek-chat` 当前本就指向 V4 Flash 的"非思考模式"。
- 假设：在弃用截止日前切换即可，不需要加急部署。建议提前 1-2 周完成，留出回滚窗口。

## 7. 开放问题

| 问题 | 影响 | 待决 |
|------|------|------|
| 是否需要在测试中 mock V4 Flash 的响应来验证兼容性？| 低——现有 mock 不关心 model name | 不需要，model name 变化不影响 mock |
| 旧 callLLM 中的 fallback 路径是否也要传 model？| 低——callLLM 本身会在 Spec 012 中被删除 | 过渡期内保持 `callDeepSeek` 不传 model 使用默认值 |
