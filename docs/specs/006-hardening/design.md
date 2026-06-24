# 设计：质量加固

> 规格 006 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)

## A. 指标埋点

`session.ts runAgent`：用 `Date.now()` 包住 `agentLoop`，结束输出一条结构化日志：

```
[metric] latency_ms=1234 status=ok chat=6585734954
```

- 失败路径（catch）也记 `status=error`。
- 埋点本身不抛错（纯 `console.log`）。
- `Date.now()` 在 Workers 请求运行时可用（非 Workflow 沙箱）。
- 不改 `agentLoop` 签名（既有测试不受影响）。

## B. 提醒自动续期

### 数据模型
给 `reminders` 加 `interval_km`（迁移 0005，纯新增列，可重入需注意 `ALTER` 非幂等→前向一次性）：

```sql
ALTER TABLE reminders ADD COLUMN interval_km REAL;   -- 里程提醒的续期间隔（NULL=一次性）
```
同步 `docs/schema.sql` / `test/utils.ts` / `types.ts`（`Reminder.interval_km`）。

### set_reminder
里程模式用 `interval_km` 计算目标时，**把 interval_km 一并存入**（绝对目标 `trigger_odometer` 模式不存，保持一次性）。

### runScheduled 续期
触发一条到期提醒并 `markReminderDone` 后：
- 若 `mode='mileage'` 且 `interval_km != null`：`insertReminder` 新建下一条，`trigger_odometer = 本次 trigger_odometer + interval_km`，沿用 `interval_km`、`type`、`vehicle_id`、`chat_id`（AC-B1）。
- 推送消息追加："已自动续期，下次 {next} km 提醒"（AC-B2）。
- 绝对里程（无 interval_km）/ 日期提醒：不续期（AC-B3/B4）。

> `findDueReminders` 用 `getActiveReminders`（status='active'）。续期插入的新提醒 status 默认 active，但其 `trigger_odometer` 已高于当前里程，下次扫描不会立即再触发——除非里程已越过，那是正确行为。

### 数据访问层
- `insertReminder` 增 `interval_km` 入参。
- `getActiveReminders` / `ReminderWithVehicle` 自动带出新列（`SELECT r.*`）。

## C. LLM 评测集

### 结构
- `test/eval/cases.json`：`[{ input, expectTool, expectArgs? }]`，覆盖各功能（AC-C3）。
- `scripts/eval.ts`（tsx 运行）：对每条用例，用真实 `buildSystemPrompt()` + input 调 `callLLM(messages, TOOLS, ...)`，断言返回的 `toolCalls[0].name === expectTool`，并（若给）校验关键参数；统计通过率。
- `npm run eval`：`tsx scripts/eval.ts`。读 `.dev.vars`/环境变量取 `DEEPSEEK_API_KEY`、`ANTHROPIC_API_KEY`。
- **不进 `npm test`**（AC-C2）。

### 复用
- 从 `agent.ts` 导出 `buildSystemPrompt`（原为私有），评测用同一份 prompt，保证评测=线上。
- `scripts/eval.ts` 仅 import 纯 TS（`TOOLS`、`callLLM`、`buildSystemPrompt`），无 Workers 运行时依赖（D1/KV 类型在运行时被擦除）。

### 输出
逐条 `✅/❌ input → got vs expect`，末尾 `通过率 N/M`。退出码非零当通过率 < 阈值（便于将来手动门禁）。

## D. 容灾（指引）
`npx wrangler secret put ANTHROPIC_API_KEY` 填 Anthropic key。代码已支持 fallback（`llm.ts`），设了即生效。

## 测试要点
- A：`session.test.ts` 不破（埋点是附加日志）；可加一条断言不影响回复。
- B：`reminders.test.ts` 增续期用例——里程提醒带 interval 触发后，active 列表出现下一条（目标+间隔）；绝对/日期提醒不续期。
- C：评测脚本不进单测；本地结构自检（用例 JSON 可解析）可选。
- 迁移 0005 本地执行 + 既有 122 测试零回归。
