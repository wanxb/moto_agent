# 任务：Google OAuth 一键登录

> 规格 018 · [requirements.md](requirements.md) · [design.md](design.md)

- [ ] T1 配置：`wrangler.toml` 加 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 标注；`src/types.ts` `Env` 加这两个字段
- [ ] T2 服务端：`src/routes/auth-handler.ts` 加 `handleGoogleLogin`（GET `/auth/google`）+ `handleGoogleCallback`（GET `/auth/google/callback` 回调）；路由分发接入
- [ ] T3 前端 i18n：`web/src/lib/i18n.ts` zh/en 各加 `google_login`、`or` 两个 key
- [ ] T4 前端 UI：`web/src/routes/Login.svelte` 加分隔线 + Google 登录按钮
- [ ] T5 构建：`npm --prefix web run build`
- [ ] T6 测试：`test/auth.test.ts` Google OAuth 发起/回调/CSRF/已存在邮箱/新邮箱
- [ ] T7 门禁：`npm run type-check && npm test` 全绿
- [ ] T8 上线：部署 + 用户配置 Google Cloud Console 凭据 + 设两个 secret + 验证端到端
