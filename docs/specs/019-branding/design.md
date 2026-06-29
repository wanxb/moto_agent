# 设计：品牌化 — 弼马温

> 规格 019 · 状态：📝 草稿 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[i18n](../../engineering/architecture.md)

## 1. 方案概述

纯品牌名替换，无功能逻辑变更。将一个入口配置（品牌名常量）注入所有用户可见位置，避免今后改名时需要逐处修改。

新增一个全局品牌配置 `src/brand.ts`，所有引用统一走常量，而不是散落在各文件中写死字符串。然后批量替换现有写死的位置。

## 2. 数据模型变更

无。品牌名不需要落库。

## 3. 新增全局品牌配置

```typescript
// src/brand.ts — 品牌名统一配置
export const BRAND = {
  nameZh: '弼马温',
  nameEn: 'Bimawen',
  taglineZh: '弼马温 · 摩托车油耗管家',
  taglineEn: 'Bimawen · Moto Fuel Agent',
  emailFrom: '弼马温',
  emailPrefix: '🔑 【弼马温】',
};
```

此后所有位置引用 `BRAND.*` 常量而非写死字符串。

## 4. 完整替换映射

| # | 位置 | 当前值 | 替换为 |
|---|------|--------|--------|
| 1 | `brand.ts`（新建） | — | `BRAND.nameZh = '弼马温'` |
| 2 | `src/i18n/zh.ts` `welcome.title` | `👋 摩托车油耗管理助手` | `👋 弼马温 · 摩托车油耗管家` |
| 3 | `src/i18n/zh.ts` `dashboard.link` | `打开 Moto Agent Dashboard` | `打开弼马温 Dashboard` |
| 4 | `src/i18n/en.ts` `welcome.title` | `👋 Moto Fuel Agent` | `👋 Bimawen · Moto Fuel Agent` |
| 5 | `src/i18n/en.ts` `dashboard.link` | `Open Moto Agent Dashboard` | `Open Bimawen Dashboard` |
| 6 | `src/services/mail.ts` `from` | `` `Moto Bot <${SENDER_EMAIL}>` `` | `` `${BRAND.emailFrom} <${env.SENDER_EMAIL}>` `` |
| 7 | `src/services/mail.ts` subject (login) | `🔑 Moto Bot 登录链接` | `🔑 【弼马温】登录链接` |
| 8 | `src/services/mail.ts` body (login) | `点击以下链接登录 Moto Bot` | `点击以下链接登录弼马温` |
| 9 | `src/services/mail.ts` subject (bind) | `🔗 Moto Bot 账号绑定` | `🔗 【弼马温】账号绑定` |
| 10 | `src/services/mail.ts` body (bind) | （无品牌名） | 不变 |
| 11 | `src/routes/auth-handler.ts` 登录页 title | `确认登录 · Moto Bot` | `确认登录 · 弼马温` |
| 12 | `src/routes/auth-handler.ts` 登录页 h1 | `🏍 确认登录 Moto Bot` | `🏍 确认登录弼马温` |
| 13 | `src/routes/auth-handler.ts` 绑定页 title | `确认绑定 · Moto Bot` | `确认绑定 · 弼马温` |
| 14 | `src/routes/auth-handler.ts` 通用页 title 模板 | `· Moto Bot` | `· 弼马温` |
| 15 | `src/prompts.ts` zh 首行 | `你是一个摩托车油耗管理助手` | `你是一个摩托车油耗管理助手「弼马温」` |
| 16 | `src/prompts.ts` en 首行 | `You are a motorcycle fuel management assistant` | `You are a motorcycle fuel management assistant "Bimawen"` |
| 17 | `web/src/lib/i18n.ts` zh `title` | `Moto Bot` | `弼马温` |
| 18 | `web/src/lib/i18n.ts` zh `login_title` | `摩托车油耗管家` | `弼马温` |
| 19 | `web/src/lib/i18n.ts` en `title` | `Moto Bot` | `Bimawen` |
| 20 | `web/src/lib/i18n.ts` en `login_title` | `Motorcycle fuel tracker` | `Bimawen` |
| 21 | `web/public/manifest.json` `name` | `Moto Bot — 摩托车油耗管家` | `弼马温 — 摩托车油耗管家` |
| 22 | `web/public/manifest.json` `short_name` | `Moto Bot` | `弼马温` |
| 23 | `web/public/manifest.json` `description` | `用对话或语音记录加油，自动计算油耗` | 不变（功能性描述） |
| 24 | `README.md` 标题 | `# 摩托车油耗管理 Bot` | `# 弼马温 — 摩托车油耗管理 Bot` |
| 25 | `CLAUDE.md` 项目描述 | `摩托车油耗管理 Telegram Bot` | `摩托车油耗管理 Telegram Bot「弼马温」` |

## 5. 不变区域（不改）

| 位置 | 原因 |
|------|------|
| `src/tools/knowledge-tools.ts` description | LLM 面向的工具描述，用"摩托车"是功能描述而非品牌名，不应改 |
| `wrangler.toml` `name` | `moto-agent.wtg2021.workers.dev` 部署 URL，改则断连 |
| `package.json` `name` | npm 包名，不影响用户 |
| `wrangler.toml` `database_name` | 脚本依赖的 D1 数据库名 |
| `docs/engineering/*` `docs/specs/*` | 内部文档，不面向用户，留待后续统一扫 |

## 6. 迁移步骤

1. 新建 `src/brand.ts`
2. 改 `src/services/mail.ts` 使用品牌常量
3. 改 `src/routes/auth-handler.ts` 使用品牌常量
4. 改 i18n 字典
5. 改 prompts.ts
6. 改 PWA 前端
7. 改 README / CLAUDE.md
8. 部署验证
