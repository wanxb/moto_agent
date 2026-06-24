# 需求：国际化（i18n）— 中英双语支持

> 规格 010 · 状态：✔️ Done · 阶段：Phase 2 末 / Phase 3 · 优先级：P2
> 关联：[ADR-0008](../../engineering/adr/0008-i18n-bilingual.md)

## 1. 问题陈述

系统硬编码为中文：系统提示、工具描述、工具输出、渠道错误提示。Phase 3 多客户端（App/Web/微信 Bot）将服务英文用户，需在对话中动态切换语言。

## 2. 用户故事

- **US1** 作为用户，我想说"说英文"切换到英文，以便用英文使用 bot。
- **US2** 作为用户，我想说"switch to Chinese"切换回中文。
- **US3** 切换后，bot 的每次回复都用对应语言（系统提示、工具输出、错误文案）。
- **US4（LLM 路由不受影响）** 英文版的工具路由准确率应达到与中文同样的 ≥ 95%。

## 3. 范围

**In Scope**
- `src/i18n/`：`zh.ts` / `en.ts` 词典，`t(key, lang, ...args)` 翻译函数。
- 系统提示中英双语（`prompts.ts` → `buildSystemPrompt(lang)`）。
- 工具 `descriptionEn` + `ToolRegistry.toOpenAI(lang)` —— 按语言选择工具描述（不影响 LLM 路由未知）。
- `set_language` 工具（对话中切换）+ `lang:{chatId}` KV（TTL 30d）。
- 工具输出 i18n（80+ 条返回文案变为 `t('key', lang)`）。

**Out of Scope**
- 数据库/车辆名翻译（车名是用户数据，不属于系统 i18n）。
- 多语言（≥5 种）——只做中英双语。

## 4. 交互示例

```
用户：说英文
Bot：🔤 Language set to English.

用户：added 10 liters of 95 gas, 98 yuan, odometer 12580
Bot：✅ Recorded (Little Green)
     📍 Odometer: 12,580 km
     ⛽ 10 L × ¥9.80/L = ¥98
     📊 Fuel consumption: 3.13 L/100km (319 km since last fill)

用户：切换到中文
Bot：🔤 语言已切换为中文。
```

## 5. 风险

| 风险 | 缓解 |
|------|------|
| 英文工具描述导致 LLM 路由退化 | 英文评测集（`npm run eval:en`）独立校验 ≥ 95% |
| 用户中英混杂输入（"说English"） | LLM 在系统提示中被告知"用户可能混合输入，你应理解后再用对应语言工具" |
| 英文系统提示长度变化影响 token | 中英长度相近（中文短但 token 多，英文长但 token 少），预估差距 < 10% |

## 6. 实施分期

| 期 | 内容 |
|----|------|
| 1 | `src/i18n/` 框架 + `set_language` 工具 + 系统提示双语 + 工具描述双语 + `ToolRegistry.toOpenAI(lang)` |
| 2 | 全部工具输出 i18n + 渠道文案 i18n + 英文评测集 `npm run eval:en` |
