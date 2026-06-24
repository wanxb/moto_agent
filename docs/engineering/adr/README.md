# 架构决策记录（ADR）

> ADR 记录**重要且不易逆转**的技术决策的背景、选择与权衡，让"为什么这么做"不消失在聊天记录里。

## 什么时候写 ADR

- 选型/换型：存储、运行时、模型 provider、框架。
- 改变架构不变量：状态管理、分层、Loop 行为。
- 任何 [`../../../CLAUDE.md`](../../../CLAUDE.md) §7 约束的变更。

## 格式

每条 ADR 一个文件 `NNNN-短标题.md`，包含：**状态 / 背景 / 决策 / 后果 / 备选方案**。一经 Accepted 不删除；被取代时新写一条并标注 `Superseded by`。

## 索引

| # | 决策 | 状态 |
|---|------|------|
| [0001](0001-typescript-over-python.md) | 用 TypeScript 而非 Python | ✅ Accepted |
| [0002](0002-cloudflare-workers-runtime.md) | 运行时选 Cloudflare Workers | ✅ Accepted |
| [0003](0003-deepseek-primary-claude-fallback.md) | DeepSeek 主 + Claude 备 + 自动 fallback | ✅ Accepted |
| [0004](0004-self-built-agent-loop.md) | 自实现 Agent Loop 而非框架 | ✅ Accepted |
| [0005](0005-d1-kv-storage.md) | D1（业务）+ KV（会话）双存储 | ✅ Accepted |

> 新增 ADR 后在此表登记，并在 [`docs/README.md`](../../README.md) 文档状态表体现（如有结构变化）。
