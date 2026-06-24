# 任务：车辆改名 + 纯文本输出

> 规格 005 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。**无数据库迁移**。emoji 保留，仅清洗 markdown。
>
> **状态：全部完成。** 测试：122 passed（新增 7 条 `test/format.test.ts` + 4 条改名）。

## A. 车辆改名

- [x] **T1 DB**：`renameVehicle(db, id, newName)`。
- [x] **T2 工具**：`rename_vehicle`（未找到/重名/同名校验）。
  - ✅ AC-A1/A3/A4；改名后 `query_stats` 表头显示新名（AC-A2，因记录关联 id）。

## B. 纯文本输出

- [x] **T3 sanitizer**：`src/format.ts` `toPlainText(s)`（去 markdown，保留 emoji / `─` / `•` / `¥` / 日期）。
  - ✅ `test/format.test.ts` 7 条：规则 + 工具样例穿过不变（AC-B1–B4）。
- [x] **T4 应用**：`session.ts` 回复前 `toPlainText`。
- [x] **T5 Prompt**：`agent.ts` 规则 15「纯文本+emoji，不用 markdown」+ 规则 8 改名。

## C. 收尾

- [x] **T6 测试**：`npm run type-check && npm test` 全绿（122 passed）。
- [x] **T7 文档**：`agent-design.md` §2、`architecture.md`、本 spec/索引/`docs/README`/`roadmap` 状态。
- [ ] **T8 部署**：`git push` +  `npm run deploy`（无迁移）— 进行中。

## 验收（DoD）
- [x] AC-A1–A4、AC-B1–B4 满足（测试验证）。
- [x] `npm run type-check && npm test` 全绿（122 passed）。
- [x] emoji 与既有工具排版不被破坏（专项断言）。
- [x] 参数化、无 secret；文档同步。
