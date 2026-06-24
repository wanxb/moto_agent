# 设计：定时提醒

> 规格 003 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[architecture](../../engineering/architecture.md) · [data-model](../../engineering/data-model.md) · [agent-design](../../engineering/agent-design.md) · 新增 [ADR-0006](../../engineering/adr/0006-cron-triggers-scheduled.md)

## 1. 方案概述

新增 `reminders` 表与三个工具（`set_reminder`/`list_reminders`/`cancel_reminder`）用于管理提醒。引入 **Cloudflare Cron Triggers**：在 `src/index.ts` 的默认导出加 `scheduled()` handler，每日唤醒一次，调用 `src/scheduled.ts` 的 `runScheduled()` 扫描到期提醒并经 Telegram Bot API 主动推送，触发后置 `status='done'` 去重。

里程提醒的"当前里程"取该车最近的加油/里程记录（新增 `getLatestOdometer`）；日期提醒按 ISO 日期字符串比较。车辆解析复用 spec 001 `resolveVehicle`；里程基准可取 spec 002 `getLastMaintenanceByType` 的里程。

**关键架构变化**：这是首个非 webhook 入口。`scheduled()` 无 per-request 用户上下文，故推送目标取 `reminders.chat_id`（预留多用户）或回退 `env.ALLOWED_CHAT_ID`（MVP 单用户）。

## 2. 数据模型变更

```sql
CREATE TABLE IF NOT EXISTS reminders (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id       INTEGER,                       -- 所属车辆（spec 001）
    type             TEXT    NOT NULL,              -- 机油/保险/年检…（标签）
    mode             TEXT    NOT NULL,              -- 'mileage' | 'date'
    trigger_odometer REAL,                          -- mileage 模式：目标里程
    trigger_date     TEXT,                          -- date 模式：ISO 日期
    note             TEXT,
    chat_id          TEXT,                          -- 推送目标（多用户预留；空→用 ALLOWED_CHAT_ID）
    status           TEXT    NOT NULL DEFAULT 'active',  -- 'active' | 'done'
    fired_at         TEXT,                          -- 触发推送时刻
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reminders_status  ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_vehicle ON reminders(vehicle_id);
```

- 迁移 `migrations/0003_reminders.sql`（纯新增、可重入）。
- 同步 `docs/schema.sql` + `test/utils.ts`（`initDB` 建表、`clearDB` 删表）+ `types.ts` `Reminder`。

## 3. wrangler.toml（Cron Triggers）

```toml
[triggers]
crons = ["0 1 * * *"]   # 每日 01:00 UTC 扫描到期提醒
```

> 见 [ADR-0006](../../engineering/adr/0006-cron-triggers-scheduled.md)。本地可用 `wrangler dev --test-scheduled` + `curl .../__scheduled` 触发验证。

## 4. 入口变化（index.ts）

默认导出新增（与 `fetch` 并列）：

```ts
async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  ctx.waitUntil(runScheduled(env));
}
```

## 5. 调度逻辑（src/scheduled.ts）

为可测试，纯逻辑与副作用分离：

```ts
// 纯判定：哪些提醒到期（注入 today，便于测试；里程经 DB 查询）
findDueReminders(db, today): Promise<DueReminder[]>
  active = getActiveReminders(db)             // LEFT JOIN vehicles 取 vehicle_name
  for r in active:
     date     → due if r.trigger_date && r.trigger_date <= today
     mileage  → odo = getLatestOdometer(db, r.vehicle_id)
                due if r.trigger_odometer != null && odo != null && odo >= r.trigger_odometer

// 副作用：推送 + 去重。send 可注入（测试用 mock，生产用 grammy Bot API）
runScheduled(env, { today?, send? }?): Promise<{ fired: number }>
  today = today ?? new Date().toISOString().slice(0,10)
  due = findDueReminders(env.DB, today)
  for r in due:
     target = r.chat_id ?? env.ALLOWED_CHAT_ID
     if !target: continue
     await send(target, formatReminder(r, today))
     await markReminderDone(env.DB, r.id, firedAt=today)
```

`formatReminder`：
- mileage：`🔔 保养提醒（{车}）\n该换{type}了：当前 {odo} km ≥ 提醒里程 {trigger} km`
- date：`🔔 提醒（{车}）\n{type} 到期：{trigger_date}`

> `new Date()` 仅在生产 `scheduled` 路径用；测试调用 `runScheduled(env, { today, send })` 注入固定日期与假发送，不依赖时钟与网络。

## 6. 工具契约（tools.ts）

| 工具 | 参数 | 作用 |
|------|------|------|
| `set_reminder` | `type`（必填）, `mode`（`mileage`/`date`，必填）, `interval_km?`, `trigger_odometer?`, `trigger_date?`, `vehicle?`, `note?` | 设提醒 |
| `list_reminders` | `vehicle?` | 列活跃提醒 |
| `cancel_reminder` | `type`（+ `vehicle?`） | 取消匹配的活跃提醒（置 done） |

`set_reminder` 里程模式解析：
1. `trigger_odometer` 给了 → 直接用（AC2）。
2. 否则 `interval_km` 给了 → 基准 = `getLastMaintenanceByType(type, vehicleId)?.odometer` ?? `getLatestOdometer(vehicleId)`；基准为空 → 返回"需要先有里程/保养记录，或直接给目标里程"；`trigger_odometer = 基准 + interval_km`（AC1）。
3. 都没有 → 提示补充。

日期模式：需 `trigger_date`，否则提示补充。车辆解析复用 `resolveVehicle`（not_found/ambiguous 走统一文案）。

## 7. 数据访问层（database.ts）

- `insertReminder(db, {...})` → id
- `getActiveReminders(db)` → `SELECT r.*, v.name AS vehicle_name FROM reminders r LEFT JOIN vehicles v ON r.vehicle_id=v.id WHERE r.status='active'`
- `listRemindersByVehicle(db, vehicleId?)` → 活跃，按车（展示用，带 vehicle_name）
- `cancelReminders(db, {type, vehicleId?})` → 置 done，返回受影响数
- `markReminderDone(db, id, firedAt)` → 置 done + fired_at
- `getLatestOdometer(db, vehicleId?)` → `MAX(odometer)` over fuel_records ∪ mileage_records（按车可选）

## 8. Prompt 影响

`buildSystemPrompt` 增最小规则：
- "设提醒用 set_reminder：里程类（'机油每3000公里'→mode=mileage,interval_km=3000；'到13000提醒'→trigger_odometer=13000）；日期类（'保险X日到期'→mode=date,trigger_date=X）。"
- "'我设了哪些提醒'用 list_reminders；'取消X提醒'用 cancel_reminder。"

## 9. 边界与错误处理

- 里程提醒但无任何里程记录 → 设置可成功（目标里程已知），只是不会触发直到有记录。
- 推送目标缺失（chat_id 与 ALLOWED_CHAT_ID 都空）→ 跳过并 `console.error`，不崩。
- 推送失败（Telegram 报错）→ catch 记日志，**不**标记 done（下次重试）。
- 去重：仅推送成功后才 `markReminderDone`（AC8）。

## 10. 风险与权衡

| 风险 | 缓解 |
|------|------|
| 里程提醒依赖用户记录 | 文档说明；日期提醒不受影响；未来可结合日均里程估算 |
| Cron 每日一次有最长 ~24h 延迟 | 保养提醒可接受；如需更快可调高频率 |
| `scheduled` 无用户上下文 | chat_id 存表 + 回退 ALLOWED_CHAT_ID |
| 时钟依赖难测 | `runScheduled` 注入 `today`/`send`，纯逻辑可测 |

## 11. 测试要点（test/reminders.test.ts）

- database：reminders CRUD、`getLatestOdometer`（跨 fuel/mileage 取 max、按车）、`getActiveReminders` JOIN 车名。
- tools：`set_reminder` 三条里程解析路径（绝对/间隔+保养基准/间隔+里程基准）、日期模式、AC1–AC5；`list`/`cancel`。
- 调度：`findDueReminders`（里程到达 AC6、日期到达 AC7、按车隔离 AC9、未到不触发）；`runScheduled` 用注入 `today` + mock `send` 断言推送内容与 **去重**（再次扫描不重发，AC8）。
- 回归：不影响加油/维保既有测试。
