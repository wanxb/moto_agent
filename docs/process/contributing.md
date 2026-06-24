# 开发协作流程

> 开发环境、Git/PR 工作流、AI 协作方式。

---

## 1. 环境搭建

```bash
npm install
cp .dev.vars.example .dev.vars   # 填入各项 key（本地用，已 gitignore）
npm run db:init                  # 初始化本地 D1
npm run dev                      # 启动本地 Worker
```

详细密钥说明见 [security §4](../engineering/security.md)，部署见 [observability-ops](../engineering/observability-ops.md)。

---

## 2. 开发循环

```
读 spec → 写代码 → npm run test:watch（边写边测）
        → npm run type-check（提交前）
        → npm test（全绿）
        → 更新文档 → 提交
```

- **非平凡功能先有 [spec](../specs/)**（SDD），别直接写码。
- 改代码同时改文档（[DoD 文档触发表](definition-of-done.md)）。

---

## 3. Git 工作流

- **不直接在 `master` 上做功能开发**：从 `master` 切功能分支。
  ```bash
  git switch -c feat/multi-vehicle    # 功能
  git switch -c fix/odometer-sort     # 修复
  git switch -c docs/update-adr       # 文档
  ```
- **提交粒度**：一个逻辑改动一个 commit，可独立通过门禁。
- **只在用户/需求方明确要求时 push 或建 PR**（[CLAUDE.md §7](../../CLAUDE.md)）。

### 提交信息

沿用现有风格（首条 commit 为 `feat: 摩托车油耗管理 Telegram Bot MVP`），约定式前缀：

| 前缀 | 用途 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | 修复 |
| `docs:` | 文档 |
| `refactor:` | 重构（无行为变化） |
| `test:` | 仅测试 |
| `chore:` | 杂项/配置 |

正文（可选）说明**为什么**，关联 spec 编号（如 `spec 001`）。

---

## 4. PR / 评审

- PR 描述：改了什么、为什么、关联 spec/AC、如何验证。
- 合并前：[通用 DoD](definition-of-done.md) 全绿。
- 评审关注：是否遵守分层纪律、schema 是否只增不删、`llm.ts` 双路径、是否漏更文档。
- 可用 `/code-review`、`/security-review` 辅助（见仓库可用技能）。

---

## 5. 与 AI 编码助手协作

本仓库为 AI 协作优化：

- AI 入口：[`../../CLAUDE.md`](../../CLAUDE.md)（Claude Code）/ [`../../AGENTS.md`](../../AGENTS.md)（其它工具）。
- 给 AI 派活的好姿势：**指向一个 spec**（如"实现 specs/001-multi-vehicle 的 T4–T8"），而非模糊描述。
- AI 产出的 DoD 与人一致（[definition-of-done](definition-of-done.md)）：type-check + test 全绿、文档同步、不谎报完成。
- 大改动建议先让 AI 出/更新 spec，对齐后再实现。

---

## 6. 目录约定

```
src/        生产代码（分层见架构文档）
test/       测试（与 src 对应）
scripts/    一次性/辅助脚本（如 seed-fuel）
migrations/ 数据库迁移（Phase 2 起，顺序命名 NNNN_*.sql）
docs/       文档（本目录）
docs/schema.sql  新库初始化建表
```
