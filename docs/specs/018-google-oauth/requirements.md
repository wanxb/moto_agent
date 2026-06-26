# 需求：Google OAuth 一键登录

> 规格 018 · 状态：📝 设计中 · 阶段：Phase 3 增强 · 优先级：P2
> 关联：[design.md](design.md) · [tasks.md](tasks.md)

## 1. 问题陈述

当前 PWA 登录仅支持 Magic Link（邮箱 + Resend 发信）。虽然实操可行，但：

1. **体验摩擦**：用户需切换 App 查邮件 → 点链接 → 确认 → 回 PWA。Google OAuth 一键跳转授权，2 次点击完成。
2. **邮件送达不确定性**：垃圾邮件过滤器、邮件网关预取 token、用户手打邮箱错误等，Magic Link 天然有失败路径。
3. **行业惯例**：竞品/同类工具普遍提供 Google 登录选项，用户已习惯 "Sign in with Google"。

提供 Google OAuth 登录作为 Magic Link 的**并列选项**，两者共享同一用户模型（email 为主键），不替代现有流程。

## 2. 用户故事

- **US1（Google 登录）** 作为摩托车手，我想用我的 Google 账号一键登录，不需要查邮件。
- **US2（账号统一）** 作为用户，无论我用 Google 还是 Magic Link 登录，看到的是同一份记录（同一个 email）。
- **US3（非 Google 用户不困扰）** 作为只用 Magic Link 的用户，Google 按钮的存在不应让我困惑。

## 3. 范围

**In Scope**
- Google OAuth 2.0 Authorization Code Flow（Server-side token exchange）。
- Worker 端 `/auth/google`（发起） + `/auth/google/callback`（回调）路由。
- CSRF 防护（state 参数 + KV 暂存）。
- 前端 Login 页面新增 "Sign in with Google" 按钮。
- Google 凭据（Client ID / Client Secret）经 `wrangler secret put` 注入。

**Out of Scope**
- Google JS SDK 弹窗/一键提示（Google Identity Services `One Tap`）——本期只做 Redirect Flow。
- Apple / Microsoft / GitHub OAuth——为未来预留。
- PWA `manifest.json` 的 `related_applications`——不是登录相关。
- 多 Google 账号关联——一个 email = 一个账号。

## 4. 验收标准（Given / When / Then）

- **AC1（发起）** Given 用户在登录页，When 点击 "Sign in with Google"，Then 302 重定向到 Google 授权页。
- **AC2（回调）** Given Google 授权成功，When 重定向回 `/auth/google/callback?code=xxx`，Then Worker 交换 token、获取 email、创建/查找用户、建 session、302 到 `/chat`。
- **AC3（CSRF）** Given 回调 `state` 参数与 KV 存储的不匹配或已过期，When 请求，Then 返回 403 错误页。
- **AC4（已存在用户）** Given Google email 已通过 Magic Link 注册，When 用 Google 登录，Then 同一账号（不创建重复），session 正常建立。
- **AC5（新用户）** Given Google email 首次登录，When 回调处理，Then 自动创建用户（`users` 表 insert），默认语言跟随 Accept-Language 或浏览器 UA。
- **AC6（Magic Link 共存）** Given 用户用 Google 登录过一次，When 再次访问登录页，Then Magic Link 输入框和 Google 按钮均可见。

## 5. 交互示例

```
1. 用户打开 moto.bbing.xyz/login
2. 看到：
   ┌────────────────────────────┐
   │  🏍 Moto Bot              │
   │  摩托车油耗管家             │
   │                            │
   │  ┌──────────────────┐      │
   │  │ 输入邮箱地址       │      │
   │  └──────────────────┘      │
   │  [  发送登录链接  ]         │
   │                            │
   │  ── 或者 ──               │
   │                            │
   │  [ 🅶 Sign in with Google ]│
   │                            │
   │  ✉️ 无需密码，无需注册     │
   └────────────────────────────┘

3. 点击 "Sign in with Google"
4. → 跳转 Google 选择账号 → 授权
5. → 回到 moto.bbing.xyz/chat（已登录）
```

## 6. 依赖与假设

- 依赖：spec 016（多用户 PWA 认证体系、`getUserByEmail` / `createUser` / `createSession`）。
- 假设：`GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET` 有效，且回调 URI 已在 Google Cloud Console 注册。
- 假设：用户浏览器允许第三方 cookie 重定向（主流浏览器默认允许，没问题）。
