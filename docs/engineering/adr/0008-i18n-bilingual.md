# ADR-0008：国际化（i18n）—— 双语支持，KV 存语言偏好

**状态**：📋 Planned ·  **日期**：Phase 2 末（规划）

## 背景

当前整个系统硬编码为中文：系统提示、所有工具 description、工具输出文案、渠道错误提示。未来多客户端（App/Web/微信 Bot）需要支持英文用户。语言切换需在对话中完成（"说英文""switch to Chinese"），而非代码配置。

## 决策

- **语言偏好存 KV**：`lang:{chatId}`，TTL 30 天，默认 `zh`。
- **工具描述双语化**：每个 `Tool` 类加 `descriptionEn: string`，`ToolRegistry.toOpenAI(lang)` 按 lang 选定返回对应版本。**不改 Tool 接口**（`description` 保留为主语言的 fallback）。
- **系统提示**：`buildSystemPrompt(lang)` 分 zh/en 两版。
- **LLM 回复本身即是目标语言**：系统提示里指定"用中文/English 回复"，用户无需关心内部翻译层——LLM 自己翻译。
- **工具输出 i18n**：每个工具 `execute()` 返回文案改成 `t('key', lang, ...args)`，翻译词典按 key 检索。
- **语言切换**：新增 `set_language` 工具（用户说"说英文""切换到中文"即切换），不经过 Agent resolution——直接由中间件拦截。

## 不做的事

- **不翻译 LLM 自然回复**：模型根据系统提示的 language 规则自己控制输出语言，不需要后处理翻译。
- **不在工具输出里硬塞 LLM 翻译**：工具返回的是**数据和事实**（"里程: 12,580 km, 油耗: 3.13 L/100km"），它们应该有固定的双语模板，而不是让 LLM 逐条翻译——省 token。
- **不持久化到数据库**：语言偏好存在 KV（会话级），不写入 `user_channels` / D1——D1 数据是多语共用的。

## 设计要点

```
用户请求
  → session.ts: lang = await getLanguage(chatId)    (KV, default 'zh')
  → buildSystemPrompt(lang)                          (zh/en)
  → ToolRegistry.toOpenAI(lang)                      (工具描述 zh/en)
  → agentLoop → tool.execute(input, db)
       → 工具内部 t('fuel.saved', lang, {...})        (工具输出 zh/en)
  → 渠道 reply
```

工具描述中英对应示例：
```
zh: "设置定时提醒。检测到'提醒'二字就务必用此工具，不要用查询工具。"
en: "Set a scheduled reminder. Whenever the user says '提醒/remind me/notify', use this tool — do NOT use query tools."
```

> ⚠️ **关键风险**：切换工具描述语言后，**LLM 路由准确率需要重新校验**。中英文测评集需独立运行（`npm run eval:zh` / `npm run eval:en`），两者均需 ≥ 95%。

## 备选方案

- **LLM 后处理翻译**：工具返回中文，LLM 翻译成目标语言。节省人力但浪费 token + 有翻译错误风险。否决。
- **单语 + 用户自切换**：不碰系统提示和工具描述，只在 prompt 末尾加"请用英文回复"。最简单但工具输出仍是中文——用户看到的中英混杂体验差。否决。

## 实施计划

| 期 | 内容 |
|----|------|
| 1 | `src/i18n/` 框架（types/zh/en/index/lang-store）+ `set_language` 工具 + 系统提示双语 + 工具描述 `descriptionEn` |
| 2 | 全部工具输出 i18n + 渠道文案 i18n + 英文评测集 `npm run eval:en` |

## 关联

[spec 010-i18n](../specs/010-i18n/)（待实施） · [architecture §6](../architecture.md) · [agent-design §3](../agent-design.md)。
