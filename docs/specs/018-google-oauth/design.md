# 设计：Google OAuth 一键登录

> 规格 018 · [requirements.md](requirements.md) · [tasks.md](tasks.md)

## 1. 总体思路

在现有 Magic Link 认证体系旁新增 Google OAuth 2.0 Authorization Code Flow。后端新增两个路由（发起 + 回调），前端新增一个按钮。用户模型不变（email 主键），Google 返回的 email 即用户标识。CSRF 用 `state` 参数 + KV 暂存（5 分钟 TTL）防护。

## 2. OAuth 流程（Authorization Code Flow）

```
用户点击 "Sign in with Google"
  → GET /auth/google
    → 生成 state（crypto.randomUUID()），存 KV（TTL 300s）
    → 构造 Google 授权 URL
    → 302 到 https://accounts.google.com/o/oauth2/v2/auth

用户在 Google 选账号、授权
  → Google 302 到 /auth/google/callback?code=xxx&state=yyy

GET /auth/google/callback
  → 校验 state（读 KV → 匹配 → 删除）
  → POST https://oauth2.googleapis.com/token（code → id_token + access_token）
  → 解析 id_token JWT payload（base64url decode）→ email, name
  → getUserByEmail(email) || createUser(email, name)
  → createSession → Set-Cookie → 302 /chat
```

- **token 交换在 Worker 端**（server-side），Client Secret 不进浏览器。
- **id_token 验 `aud`**（audience）：确保 token 是发给我们的 Client ID 的。
- **无 PKCE**：Authorization Code Flow 的 token 交换是 server-to-server（Worker → Google），PKCE 主要防御的拦截场景不适用（code 已沿 redirect 暴露一次，但 Client Secret 不在浏览器）。

## 3. 数据存储

**KV 暂存 state（防 CSRF）**

| Key | Value | TTL |
|------|-------|-----|
| `oauth_state:<uuid>` | `'{ "expiresAt": <unix_sec> }'` | 300s |

回调整时读 KV → 匹配 → 立即删除（一次性消费 + 防重放）。

**users 表（已有，无 schema 变更）**

`createUser()` 现有签名 `(db, { email, name? })`。Google 回调时传 `name`（来自 id_token），其余字段留默认值。

## 4. 服务端路由

### 4.1 `GET /auth/google` — 发起 OAuth

```
1. 读 env.GOOGLE_CLIENT_ID（secret）
2. 生成 state = crypto.randomUUID()
3. 写 KV: oauth_state:<state> = { expiresAt: nowSec() + 300 }
4. 构造 URL:
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=<GOOGLE_CLIENT_ID>
     &redirect_uri=<baseUrl>/auth/google/callback
     &response_type=code
     &scope=openid+email+profile
     &state=<state>
     &access_type=online
5. 302 重定向
```

### 4.2 `GET /auth/google/callback` — OAuth 回调

```
1. 取 code, state 参数
2. 读 KV oauth_state:<state>，校验存在且未过期 → 删 KV
3. 无效/过期 → 403 错误页
4. POST https://oauth2.googleapis.com/token
   body（application/x-www-form-urlencoded）:
     code=<code>
     client_id=<GOOGLE_CLIENT_ID>
     client_secret=<GOOGLE_CLIENT_SECRET>
     redirect_uri=<callback URL>
     grant_type=authorization_code
5. 失败（非 200）→ 500 错误页
6. 拿 id_token → 解析 JWT payload（base64url decode 中间段）
7. 验 aud === GOOGLE_CLIENT_ID
8. 取 email, name, email_verified
9. email_verified !== true → 403 错误页
10. getUserByEmail(email) → 有则复用，无则 createUser(email, name)
11. updateUserLastLogin
12. createSession → Set-Cookie → 302 /chat
```

错误页复用现有 `page(title, msg)` helper + `STYLE`，与 verify/bind 页风格一致。

## 5. 前端改动

### `web/src/lib/i18n.ts` — 新增 key

```
google_login:
  zh: '🅶 Google 账号登录'
  en: '🅶 Sign in with Google'
```

### `web/src/routes/Login.svelte` — 新增按钮

表单下方加分隔线 + Google 按钮：

```svelte
<div class="sep"><span>── {tr(lang, 'or')} ──</span></div>
<button class="google" onclick={() => { location.href = '/auth/google'; }}>
  🅶 {tr(lang, 'google_login')}
</button>
```

- Google 按钮用 Google 品牌色（`#4285f4` 蓝底白字），与邮箱登录按钮区分。
- 按钮直接 `location.href` 跳转，无需 `fetch`（避免 CORS/跨域 cookie 问题）。

## 6. 配置与密钥

| 变量 | 来源 | 方式 |
|------|------|------|
| `GOOGLE_CLIENT_ID` | Google Cloud Console OAuth 凭据 | `wrangler secret put` |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console OAuth 凭据 | `wrangler secret put` |

`wrangler.toml` 加标注（不对值，纯文档）：

```toml
# Google OAuth（spec 018）
#   GOOGLE_CLIENT_ID
#   GOOGLE_CLIENT_SECRET
```

`src/types.ts` `Env` 加：

```ts
GOOGLE_CLIENT_ID?: string;    // spec 018 Google OAuth
GOOGLE_CLIENT_SECRET?: string; // spec 018 Google OAuth
```

## 7. 测试

`test/auth.test.ts`（已有 auth 测试）新增 Google OAuth case：
- `GET /auth/google` → 302 + state 写 KV
- `GET /auth/google/callback?code=xxx&state=valid`（mock Google token 端点）→ 302 + session cookie
- `GET /auth/google/callback?state=invalid` → 403
- 已存在 email（Google 登录复用已有账号）→ 不重复 createUser
- 新 email → createUser 调用

所有 LLM 调用 mock；Google `oauth2.googleapis.com/token` mock 用 `fetchMock` 或 `globalThis.fetch` 的 spy。

## 8. 风险

- **Google 服务不可用**：不影响 Magic Link 登录（共存方案）。
- **Client Secret 泄漏**：sever-side 交换 token 且 secret 经 `wrangler secret put` 加密存储，不进入版本控制。
- **回调 URL 被伪造**：state 参数 + KV 一次性消费防 CSRF。
- **id_token 伪造**：通过 Google HTTPS 返回的 JWT 验 `aud`；如需进一步加强可验 Google 的 JWK 签名（https://www.googleapis.com/oauth2/v3/certs），但 server-to-server HTTPS 回包信任 + aud 校验对个人工具已足够。
