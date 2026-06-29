# 任务：品牌化 — 弼马温

> 规格 019 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 状态标记：✅ 完成 · 🚧 进行中 · ⏳ 待开始

## T1 新建品牌配置常量

- [ ] 新建 `src/brand.ts` 导出 `BRAND` 对象
- [ ] 包含 `nameZh`, `nameEn` 等字段（见 design.md §3）
- [ ] `type-check` 通过

## T2 邮件发件人 + 标题改造

- [ ] `src/services/mail.ts` `from` 改为 `${BRAND.emailFrom} <...>`
- [ ] `src/services/mail.ts` 登录邮件主题/正文品牌名替换
- [ ] `src/services/mail.ts` 绑定邮件主题替换

## T3 登录/绑定页面标题改造

- [ ] `src/routes/auth-handler.ts` 登录确认页 title + h1
- [ ] `src/routes/auth-handler.ts` 绑定确认页 title
- [ ] `src/routes/auth-handler.ts` 通用 `page()` 函数 title 后缀

## T4 i18n 字典改造

- [ ] `src/i18n/zh.ts`: `welcome.title`, `dashboard.link`
- [ ] `src/i18n/en.ts`: `welcome.title`, `dashboard.link`

## T5 系统提示词改造

- [ ] `src/prompts.ts` zh 首行自我介绍
- [ ] `src/prompts.ts` en 首行自我介绍

## T6 PWA 前端改造

- [ ] `web/src/lib/i18n.ts` zh/en `title`, `login_title`
- [ ] `web/public/manifest.json` `name`, `short_name`

## T7 文档改造

- [ ] `README.md` 标题 + 首段
- [ ] `CLAUDE.md` 项目描述

## T8 验收

- [ ] `npm run type-check` 通过
- [ ] `npm test` 全绿
- [ ] `npm --prefix web run build` 通过
- [ ] `npm run deploy` 成功
- [ ] 冒烟：TG Bot /start 显示"弼马温"
- [ ] 冒烟：PWA 标题显示"弼马温"
- [ ] 冒烟：邮件发件人显示"弼马温"
