# Spec 010 — 国际化（中英双语）任务列表

| 字段 | 内容 |
|------|------|
| **Spec** | 010 |
| **需求** | [requirements.md](requirements.md) |
| **设计** | [design.md](design.md) |
| **完成标准** | [definition-of-done.md](../../process/definition-of-done.md) |
| **当前状态** | ✔️ Done |

---

## T1 i18n 基础设施
- [x] 创建 `src/i18n/types.ts`（Lang 类型）
- [x] 创建 `src/i18n/zh.ts`（~80 中文翻译 key）
- [x] 创建 `src/i18n/en.ts`（~80 英文翻译 key）
- [x] 创建 `src/i18n/index.ts`（t(), fmtNumber(), fmtKm(), fmtCost(), getLang/setLang(), detectLang()）

## T2 Tool 接口 + 语言管道
- [x] Tool 接口增加 `descriptionEn?: string` + `execute` 增加 `lang: Lang` 参数
- [x] `ToolRegistry.toOpenAI(lang)` 按语言选描述
- [x] `ToolRegistry.dispatch(name, input, db, lang)` 传递语言
- [x] `_helpers.ts` fmtKm/fmtCost 改为委托 `src/i18n`
- [x] `ambiguousMsg` 增加 `lang` 参数

## T3 工具输出翻译
- [x] `fuel-tools.ts` — 全部 5 个工具输出 `t()` 化
- [x] `vehicle-tools.ts` — 全部 6 个工具输出 `t()` 化
- [x] `mileage-tools.ts` — `t()` 化
- [x] `maintenance-tools.ts` — 全部 2 个工具输出 `t()` 化
- [x] `reminder-tools.ts` — 全部 3 个工具输出 `t()` 化
- [x] `scheduled.ts` — 推送文案（cron 默认 zh）
- [x] 所有 `toLocaleString('zh')` → `fmtNumber(n, lang)`（13 处）

## T4 工具描述 + 系统提示词
- [x] 每个 Tool 类增加 `descriptionEn`
- [x] `buildSystemPrompt(lang)` 中英两个版本
- [x] STT Whisper `language` 参数跟随用户语言

## T5 语言检测 + 入口文案
- [x] Bot middleware 自动检测 `ctx.from?.language_code` → `detectLang()`
- [x] `/lang zh|en` 命令手动切换
- [x] `session.ts` 读取/写入 `lang:{chatId}` KV
- [x] `agent.ts` `agentLoop()` 传递 `lang` 参数
- [x] `index.ts` WELCOME/HELP/错误消息/语音提示全部双语

## T6 Dashboard 双语
- [x] `dashboardPage(token, lang?)` 接受语言参数
- [x] JS 内嵌 `I18N` 字典（zh/en 各 ~20 keys）
- [x] URL `?lang=en` > `navigator.language` > 默认 `zh` 自动检测
- [x] 所有 HTML 文案（按钮、表头、卡片、空态、图表 label）`t()` 化

## T7 测试 + 门禁
- [x] 新增 `test/i18n.test.ts`（10 测试：t(), fmt*, detectLang, key 对齐）
- [x] `npm run type-check` 零错误
- [x] `npm test` 205 测试全部通过
- [x] 现有测试回归（agent/test session 测试适配新签名）

## DoD 检查清单
- [x] 对应 requirements.md 全部 AC 满足
- [x] 不需要数据库迁移
- [x] 新功能有测试覆盖
- [x] type-check + test 全绿
- [x] spec 状态更新为 ✔️ Done
- [x] ADR-0008 状态更新为 Implemented
