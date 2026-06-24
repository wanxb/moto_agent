# 设计：提醒去重 + 会话回合截断

> 规格 007 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)

**无数据库结构变更。** 两处纯逻辑修复。

## A. 提醒去重

`setReminder`（`src/tools.ts`）在两处 `insertReminder` 前各加一行：

```ts
const replaced = await cancelReminders(db, { type, vehicleId });  // 作废同车同类型 active 提醒
await insertReminder(db, { ... });
return `${replaced > 0 ? '🔁 已更新提醒' : '🔔 已设置提醒'}${tag}\n...`;
```

- 复用已有 `cancelReminders(db, { type, vehicleId })`（置 `status='done'`）。
- 校验失败的早返回（缺间隔/缺日期/基准为空/车辆歧义）都在 cancel **之前**，不会误删。
- `vehicleId` 由 `resolveVehicle` 得到；多车无默认会在更早处歧义反问，到此 `vehicleId` 必为确定值或 undefined（单车）。

## B. 会话回合截断

`src/session.ts` 新增并导出 `trimHistory(messages, maxMessages)`，替换原 `messages.slice(-max)`：

```
找出所有 user 消息下标 userIdxs
取最靠前但满足 (len - i) ≤ maxMessages 的 user 下标 i 作为 start
都不满足 → 取最后一个 user 下标（单回合超长，宁可超额也从 user 起）
return messages.slice(start)
```

正确性依据：每个回合以 `user` 开头；Agent Loop 内 assistant(tool_calls) 与其 tool 结果总是同回合内连续 push。**从任一 `user` 边界起的前缀**必然 tool_call/结果配对完整、不悬空（满足 AC-B1/B2）。

> 取舍：不再保证恰好 ≤ maxMessages（单个超长回合会超额），但**正确性优先于条数上限**。超时（MAX_ROUNDS）致历史以 tool 结尾的罕见情形不在本次范围。

## 测试
- `reminders.test.ts`：替换不叠加（AC-A1）、按车+类型隔离（AC-A2）。
- `trim.test.ts`：从 user 起、不切散 tool 配对、单超长回合退化、短/空历史（AC-B1–B3）。
