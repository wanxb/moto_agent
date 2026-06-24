# 任务：<功能名>

> 规格 NNN · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。每条任务可独立验证。

## 任务清单

> 顺序：数据模型 → 数据访问 → 工具 → prompt → 测试 → 文档。每条勾选前确认其验证项通过。

- [ ] **T1 数据模型**：<迁移 SQL + docs/schema.sql + test/utils.ts 同步>
  - 验证：`npm run db:init` 成功；测试库可建表。
- [ ] **T2 数据访问**：<database.ts 新增 SQL 函数>
  - 验证：`database.test.ts` 覆盖。
- [ ] **T3 工具**：<tools.ts 定义 + dispatch + 实现>
  - 验证：`tools.test.ts` 覆盖正常 + 边界。
- [ ] **T4 Prompt**：<agent.ts buildSystemPrompt 增量规则（如需）>
  - 验证：相关 agent 测试 / 人工验证。
- [ ] **T5 测试**：<补齐单元 + 集成测试>
  - 验证：`npm test` 全绿。
- [ ] **T6 文档**：<更新 data-model / agent-design / CLAUDE.md 受影响处；勾掉本 spec>
  - 验证：文档与代码一致。

## 验收（Definition of Done）

- [ ] 所有 `requirements.md` 验收标准（AC）满足。
- [ ] `npm run type-check && npm test` 全绿。
- [ ] 受影响文档已更新（同 PR）。
- [ ] 无 secret 泄露，遵守 [安全清单](../../engineering/security.md) §7。
