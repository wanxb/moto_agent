# AGENTS.md

本仓库面向 AI 编码助手的操作规范以 **[`CLAUDE.md`](CLAUDE.md)** 为准（Cursor、GitHub Copilot、Windsurf、Codex 等任何遵循 `AGENTS.md` 约定的工具请直接以该文件为单一事实来源）。

## 速览

- **项目**：摩托车油耗管理 Telegram Bot（Cloudflare Workers + D1 + KV，自实现 Agent Loop，DeepSeek 主 / Claude 备）。
- **入口手册**：[`CLAUDE.md`](CLAUDE.md)
- **人类文档索引**：[`docs/README.md`](docs/README.md)
- **产品需求**：[`PRD.md`](PRD.md)

## 五条必读铁律（详见 CLAUDE.md §2）

1. 改动前先看 [`docs/specs/`](docs/specs/) 的规格，没有就先补 SDD 三件套。
2. Workers 无状态——状态进 `SESSION_KV` / `DB`，绝不用模块级变量。
3. 新能力 = 新工具（`src/tools.ts`），不是改 Loop。
4. 改 `src/llm.ts` 要同时覆盖 DeepSeek 与 Anthropic 两条路径。
5. 完成标准：`npm run type-check && npm test` 全绿，且不提交任何 secret。

## 常用命令

```bash
npm run dev          # 本地开发
npm test             # 测试
npm run type-check   # 类型检查
npm run deploy       # 部署
```
