# ADR-0001：用 TypeScript 而非 Python

**状态**：✅ Accepted ·  **日期**：MVP 期

## 背景

项目最初设想用 Python（Agent 生态成熟）。但目标运行时是 Cloudflare Workers，需评估语言与运行时的契合度。

## 决策

**用 TypeScript 实现整个 Bot。**

## 理由 / 后果

**正面**：
- TypeScript 是 Cloudflare Workers 的一等公民，`wrangler`、D1、KV 工具链全部原生支持。
- 类型安全（`strict: true`）对 LLM 工具 Schema、消息格式互转这类易错处帮助大。
- Agent Loop 的核心（`while` + 工具调度）语言无关，移植成本低。

**负面 / 代价**：
- 放弃 Python 的 Agent 库生态（LangChain 等）——但本项目自实现 Loop（见 [ADR-0004](0004-self-built-agent-loop.md)），本就不依赖这些库。
- 团队需用 TS。

## 备选方案

- **Python on Workers**：当时仍属实验阶段，限制多（无完整文件系统、网络受限、Pyodide 体积大）。否决。
- **Python on 传统 Serverless/VPS**：可行但偏离 Cloudflare 零运维/低成本目标（见 [ADR-0002](0002-cloudflare-workers-runtime.md)）。否决。

## 关联

[ADR-0002](0002-cloudflare-workers-runtime.md) · [`../../../PRD.md`](../../../PRD.md) §5.1 语言变更说明。
