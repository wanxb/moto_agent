# 任务：提醒去重 + 会话回合截断

> 规格 007 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> **无数据库迁移。** 状态：全部完成。测试：131 passed。

- [x] **T1 提醒去重**：`setReminder` 两处 insert 前 `cancelReminders({type, vehicleId})`，回复区分"已更新/已设置"。
  - ✅ `reminders.test.ts`：替换不叠加（AC-A1）、按车+类型隔离（AC-A2）。
- [x] **T2 回合截断**：`session.ts` 新增导出 `trimHistory`，替换 `slice(-max)`。
  - ✅ `trim.test.ts` 5 条：从 user 起、不切散 tool 配对、单超长回合退化、短/空（AC-B1–B3）。
- [x] **T3 文档**：`agent-design.md` §5（会话上下文回合对齐）、§2（提醒替换）、本 spec/索引/状态。
- [ ] **T4 部署**：提交 + push + `npm run deploy`（无迁移）— 进行中。

## 验收（DoD）
- [x] AC-A1/A2、AC-B1–B3 满足。
- [x] `npm run type-check && npm test` 全绿（131 passed）。
- [x] 无 secret、无 SQL 注入面（复用参数化的 cancelReminders）；文档同步。
