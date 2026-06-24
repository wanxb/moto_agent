# 完成定义（Definition of Done）

> 一个改动满足以下全部条件才算"完成"。AI 编码助手不得在未满足时声称完成（[CLAUDE.md §2](../../CLAUDE.md)）。

---

## 通用 DoD（每个改动）

- [ ] **类型检查通过**：`npm run type-check`（`tsc --noEmit`）零错误。
- [ ] **测试全绿**：`npm test`（vitest）全部通过。
- [ ] **新增/改 bug 带测试**：新功能有对应单测；修 bug 有复现测试。
- [ ] **遵守编码规范**：[coding-standards](coding-standards.md)。
- [ ] **无 secret 泄露**：无 key/token 进 git；`.dev.vars` 未提交。
- [ ] **文档同步**：受影响的文档**在同一改动内**更新（见下"文档触发表"）。
- [ ] **日志合理**：关键路径有前缀化日志，不打印敏感数据。

> 没有独立 lint/format 命令——`tsc --strict` + 测试即门禁。

---

## 功能开发额外 DoD（走 SDD 的功能）

- [ ] 对应 [`specs/`](../specs/) 三件套存在，`requirements.md` 的**全部验收标准（AC）满足**。
- [ ] `tasks.md` 全部勾选。
- [ ] 涉及 schema：迁移幂等、`schema.sql` 与 `test/utils.ts` 同步、本地→`--remote` 验证、存量数据零损失。
- [ ] 涉及 `llm.ts`：DeepSeek + Anthropic 两条路径都测。
- [ ] spec 状态更新为 ✔️ Done，[specs 索引](../specs/README.md) 同步。

---

## 部署额外 DoD（上线）

- [ ] `type-check` + `test` 全绿后再 `npm run deploy`。
- [ ] 数据库迁移已在 `--remote` 执行。
- [ ] [部署后冒烟](../engineering/observability-ops.md) §3.4 通过。
- [ ] `wrangler tail` 确认无新增 error。

---

## 文档触发表（改了 X 就更新 Y）

| 改动 | 必须更新的文档 |
|------|--------------|
| 新增/改工具 | [agent-design](../engineering/agent-design.md) §2、[CLAUDE.md](../../CLAUDE.md) §4 |
| 改 schema | [data-model](../engineering/data-model.md) §1/§7、`schema.sql`、`test/utils.ts` |
| 改鉴权/密钥 | [security](../engineering/security.md)、`.dev.vars.example` |
| 改架构/分层 | [architecture](../engineering/architecture.md)、可能需 [ADR](../engineering/adr/) |
| 换/加 LLM provider | [agent-design §4](../engineering/agent-design.md)、新 [ADR](../engineering/adr/) |
| 改部署/运维流程 | [observability-ops](../engineering/observability-ops.md)、[README](../../README.md) |
| 改产品范围/路线 | [PRD](../../PRD.md)、[roadmap](../product/roadmap.md) |

---

## "未完成"的信号（不得标记完成）

- 测试失败或被跳过。
- 实现只做了一半 / 有 TODO 占位。
- 遇到未解决的错误或找不到依赖文件。
- 文档与代码不一致。

> 遇阻时保持任务 in_progress，并明确说明阻塞点，而非谎报完成。
