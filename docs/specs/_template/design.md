# 设计：<功能名>

> 规格 NNN · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[architecture](../../engineering/architecture.md) · [data-model](../../engineering/data-model.md) · [agent-design](../../engineering/agent-design.md) · [security](../../engineering/security.md)

## 1. 方案概述

<整体怎么做，一段话。>

## 2. 数据模型变更

> 遵守"只增不删"（[data-model](../../engineering/data-model.md) §5）。

```sql
-- 迁移 SQL（幂等）
```

- `schema.sql` 更新：…
- `test/utils.ts` 同步：…

## 3. 工具契约变更

> 新能力 = 新/改工具（[agent-design](../../engineering/agent-design.md) §2）。

| 工具 | 新增/修改 | 参数 | 返回 |
|------|----------|------|------|
| … | … | … | … |

## 4. Prompt 影响

<system prompt 是否需新增规则？最小化。>

## 5. 数据访问层（database.ts）

<新增/修改的 SQL 函数。>

## 6. 流程 / 时序

<关键交互的步骤或时序，必要时画 ASCII 图。>

## 7. 边界与错误处理

- …

## 8. 风险与权衡

| 风险 | 缓解 |
|------|------|
| … | … |

## 9. 测试要点

<对应 [testing-strategy](../../engineering/testing-strategy.md)，列要覆盖的关键路径与边界。>
