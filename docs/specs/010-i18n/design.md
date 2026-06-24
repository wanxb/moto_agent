# Spec 010 — 国际化（中英双语）设计文档

| 字段 | 内容 |
|------|------|
| **Spec** | 010 |
| **需求** | [requirements.md](requirements.md) |
| **任务** | [tasks.md](tasks.md) |
| **约束来源** | [data-model.md](../../engineering/data-model.md)、[agent-design.md](../../engineering/agent-design.md)、ADR-0008 |

---

## 1. 方案概述

新增 `src/i18n/` 目录，提供翻译字典 + `t()` 翻译函数 + 数字格式化工具。语言偏好存储在 `SESSION_KV`（key: `lang:{chatId}`）。工具描述、系统提示词、所有工具输出均支持中英双语。Dashboard 前端通过 `I18N` JS 字典 + `?lang=` URL 参数 + 浏览器自动检测实现。

## 2. 翻译字典

### 2.1 目录结构

```
src/i18n/
  types.ts      # Lang = 'zh' | 'en'
  zh.ts         # 中文翻译字典 (~80 keys)
  en.ts         # 英文翻译字典 (~80 keys)
  index.ts      # t(), fmtNumber(), fmtKm(), fmtCost(), getLang/setLang(), detectLang()
```

### 2.2 Key 命名

格式：`模块.语义`，如 `log_fuel.ok`、`vehicle.renamed`。用 `{0}` `{1}` 占位参数。

### 2.3 关键函数

```typescript
t(key: string, lang: Lang, ...args: (string|number)[]): string   // 翻译 + 占位替换
fmtNumber(n: number, lang: Lang): string                          // 数字格式化（zh-CN / en-US）
fmtKm(n: number | null, lang: Lang): string                       // 里程格式化
fmtCost(n: number | null, lang: Lang): string                     // 费用格式化
getLang(kv: KVNamespace, chatId: string): Promise<Lang | null>    // 读语言偏好
setLang(kv: KVNamespace, chatId: string, lang: Lang): Promise<void>  // 写语言偏好
detectLang(languageCode?: string): Lang                           // Telegram language_code → Lang
```

## 3. 语言检测与存储

- **自动检测**：bot middleware 读取 `ctx.from?.language_code`，首次对话写入 `lang:{chatId}` KV（TTL 30 天）
- **手动切换**：`/lang zh` / `/lang en` 命令
- **默认值**：无 KV 且无 language_code → `zh`
- **`zh*`** 前缀（zh-CN, zh-TW 等）→ `zh`，其余 → `en`

## 4. Tool 接口变更

### 4.1 Tool 接口

```typescript
export interface Tool {
  name: string;
  description: string;
  descriptionEn?: string;  // 新增：英文工具描述
  parameters: Record<string, unknown>;
  required: string[];
  execute(input: Record<string, unknown>, db: D1Database, lang: Lang): Promise<string>;  // lang 参数
}
```

### 4.2 ToolRegistry

```typescript
toOpenAI(lang: Lang = 'zh'): ToolDefinition[]   // 按语言选 description/descriptionEn
dispatch(name, input, db, lang = 'zh'): Promise<string>  // 传递 lang 给 execute
```

## 5. 系统提示词

`buildSystemPrompt(lang: Lang)` — 中英两个版本。英文版 rule 6 改为 "Reply concisely, in English"。

## 6. Bot 入口

- `WELCOME` / `HELP` → `t('welcome.title', lang)` 等
- 语音消息提示、Dashboard 链接、错误消息 → 全部 `t()` 化
- STT Whisper `language` 参数跟随用户语言（`zh` / `en`）

## 7. Dashboard 双语

- `dashboardPage(token, lang?)` 接受 `lang` 参数
- JS 内嵌 `I18N` 字典（zh/en 各 ~20 keys）
- 语言检测优先级：URL `?lang=en` > 浏览器 `navigator.language` > 默认 `zh`
- 所有文案（按钮、表头、卡片标签、空态、图表 label）均从字典取

## 8. 不修改的部分

- `src/database.ts` — 纯数据访问无用户文字
- `src/types.ts` — Env 不变（复用 `SESSION_KV`）
- `wrangler.toml` — 无新绑定

## 9. 测试

`test/i18n.test.ts` — 10 测试覆盖：
- `t()` 中英翻译 + 占位替换
- `fmtNumber` / `fmtKm` / `fmtCost` 中英格式化
- `detectLang()` 自动检测逻辑
- zh/en key 对齐检查
