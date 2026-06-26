# 设计：多用户 PWA — 邮箱认证 + 对话式 Web 界面

> 规格 016 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[architecture](../../engineering/architecture.md) · [data-model](../../engineering/data-model.md) · [agent-design](../../engineering/agent-design.md) · [security](../../engineering/security.md)

---

## 1. 方案概述

在 Cloudflare Worker 中扩展以下能力：

1. **用户认证系统**：邮箱 Magic Link（**Resend 免费层**发信，100 封/天）+ KV session token，**近零第三方费用**（仅需在 Resend 验证发件域名 + `RESEND_API_KEY`）
2. **用户数据模型**：新建 `users` 表；`vehicles`、三张记录表与 `reminders` 均补 `user_id` 列直接隔离；存量数据迁移至管理员用户
3. **PWA 前端**：独立 `web/` 子项目（**Vite + Svelte**），构建成静态资源由现有 Worker 经 `[assets]` 绑定托管（[ADR-0010](../../engineering/adr/0010-frontend-svelte-spa-static-assets.md)）；含气泡聊天 + 快捷操作面板 + 语音输入。Worker 退回成纯 API + Bot + auth 端点
4. **Telegram 绑定**：新增 `/bind` 命令，通过邮箱验证码关联 TG 账号

整体架构：

```
                  ┌──────────────────────────────┐
   web/ (Svelte)  │  [assets]  web/dist/         │  ← Vite 构建产物，由 Worker 托管
   Vite 构建 ───► │  SPA shell + /login /chat …  │     (公开返回，壳内无用户数据)
                  └──────────────┬───────────────┘
                                 │ fetch(API, cookie)
┌────────────────────────────────┼─────────────────────────┐
│                    Cloudflare Worker (动态路由)            │
│                                 ▼                         │
│  ┌──────────┐  ┌────────────────┐  ┌──────────────────┐   │
│  │ Telegram  │  │ Chat/Voice/API │  │  Auth Routes     │   │
│  │ Bot       │  │ /chat/* /api/* │  │  /auth/*         │   │
│  └─────┬─────┘  └───────┬────────┘  └────────┬─────────┘   │
│        │               │                    │             │
│        ▼               ▼                    ▼             │
│  ┌────────────────────────────────────────────────────┐   │
│  │          中间件层 (auth + data isolation)          │   │
│  │  · Session token 校验                               │   │
│  │  · 用户白名单 (替代原 ALLOWED_CHAT_ID)              │   │
│  │  · 查询级 user_id 过滤                              │   │
│  └────────────────────────┬───────────────────────────┘   │
│                           │                               │
│                           ▼                               │
│  ┌────────────────────────────────────────────────────┐   │
│  │              Agent Loop + Tools                      │   │
│  │              (baseline unchanged)                    │   │
│  └────────────────────────┬───────────────────────────┘   │
│                           │                               │
│                           ▼                               │
│  ┌────────────────────────────────────────────────────┐   │
│  │    D1 (users + vehicles + records + reminders)     │   │
│  └────────────────────────────────────────────────────┘   │
│                                                           │
│  KV:  · session:{token} → user session                    │
│       · magic_link:{token} → login request                │
│       · bind_code:{email} → binding code                  │
│       · session:pwa:{user_id} → PWA dialog history        │
└──────────────────────────────────────────────────────────┘
```

---

## 2. 数据模型变更（迁移 0009）

> 遵守"只增不删"（[data-model](../../engineering/data-model.md) §5）：只 `CREATE TABLE`/`ADD COLUMN`/`ADD INDEX`，不改既有列语义。
> 迁移文件 `migrations/0009_multi_user.sql`（`0008` 已被 spec 017 占用）。`ADD COLUMN` 非幂等，重复执行报 `duplicate column` 即已迁移。

### 新建 users 表

```sql
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    UNIQUE,                  -- 邮箱（pwa 用户必填，tg-only 用户暂空）
    telegram_id TEXT    UNIQUE,                  -- Telegram chat_id（tg 用户必填）
    nickname    TEXT,                            -- 昵称（可选）
    lang        TEXT    NOT NULL DEFAULT 'zh',   -- 语言偏好 'zh' | 'en'
    is_admin    INTEGER NOT NULL DEFAULT 0,      -- 1=管理员（存量数据迁移目标）
    status      TEXT    NOT NULL DEFAULT 'active', -- 'active' | 'merged'（账号合并后失活）
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT                             -- 最近登录时间
);
```

### 既有表补 user_id（直接隔离，不靠 JOIN）

`vehicles` 已有 `user_id` 列（schema 中 "Phase 3 预留"）。本期给三张记录表与 `reminders` **各补一列 `user_id`**，让隔离不依赖 `vehicle_id` 关联——否则 `vehicle_id IS NULL` 的孤儿记录无法归属、会跨用户泄露。

```sql
ALTER TABLE fuel_records        ADD COLUMN user_id INTEGER;
ALTER TABLE mileage_records     ADD COLUMN user_id INTEGER;
ALTER TABLE maintenance_records ADD COLUMN user_id INTEGER;
ALTER TABLE reminders           ADD COLUMN user_id INTEGER;  -- 归属；chat_id 保持"推送目标"原义不变
CREATE INDEX IF NOT EXISTS idx_fuel_user      ON fuel_records(user_id);
CREATE INDEX IF NOT EXISTS idx_mileage_user   ON mileage_records(user_id);
CREATE INDEX IF NOT EXISTS idx_maint_user     ON maintenance_records(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_user  ON vehicles(user_id);
```

> **关键**：`reminders.chat_id`（TEXT，Telegram 推送目标）**绝不被改写**——cron 直接拿它 `sendMessage`（见 `src/scheduled.ts`）。归属用新列 `user_id`，与推送目标解耦。

### env var 变更

| 变量 | 变更 | 说明 |
|------|------|------|
| `ALLOWED_CHAT_ID` | 保留，但**不再做访问门控**；语义变为"管理员 chat_id" | 仅用于迁移存量数据归属 + 旧 Dashboard `?token=`。Bot 已开放自助，任何 TG 用户可用 |
| `DASHBOARD_URL` | 保留 | PWA 和 Bot 同域名，也是 Magic Link 域名 |
| 新增 `RESEND_API_KEY` | 新增 **secret**（`wrangler secret put`） | Resend API key，绝不进 git |
| 新增 `SENDER_EMAIL` | 新增环境变量 | 发件地址，须属于在 Resend 验证过的域名（如 `noreply@<domain>`） |

### 同步点

- `docs/schema.sql` 加入 `users` 表 + 四张表的 `user_id` 列与索引
- `test/utils.ts` 建表语句同步
- `src/types.ts` 增加 `User` 接口；`FuelRecord`/`MileageRecord`/`MaintenanceRecord`/`Reminder` 加 `user_id`

---

## 3. 认证流程

### 3.1 邮箱 Magic Link

```
User                     PWA                      Worker                 Resend                  KV
 │                        │                         │                       │                   │
 │ 输入邮箱               │                         │                       │                   │
 │───────────────────────►│                         │                       │                   │
 │                        │ POST /auth/send-link    │                       │                   │
 │                        │ { email }               │                       │                   │
 │                        │────────────────────────►│                       │                   │
 │                        │                         │ 生成 token(UUID)      │                   │
 │                        │                         │ 存 magic_link:{token} │                   │
 │                        │                         │ ─────────────────────────────────────►     │
 │                        │                         │  {"email",expires_at}                    │
 │                        │                         │                       │                   │
 │                        │                         │ POST /emails (Resend) │                   │
 │                        │                         │──────────────────────►│                   │
 │                        │                         │ 邮件: 点击登录         │                   │
 │   ✉️ 收到邮件          │                         │◄──────────────────────│                   │
 │◄─────────────────────────────────────────────────│                       │                   │
 │                        │                         │                       │                   │
 │  点击链接              │                         │                       │                   │
 │───────────────────────►│                         │                       │                   │
 │                        │ GET /auth/verify        │                       │                   │
 │                        │ ?token=xxx              │                       │                   │
 │                        │────────────────────────►│                       │                   │
 │                        │                         │ 查询 magic_link:xxx   │                   │
 │                        │                         │◄────────────────────────├───────────────────│
 │                        │                         │                       │                   │
 │                        │                         │ 1. 校验 token 未过期  │                   │
 │                        │                         │ 2. 删除该 token(一次性)│                   │
 │                        │                         │ 3. email 存在? 登录   │                   │
 │                        │                         │    不存在? 创建用户   │                   │
 │                        │                         │ 4. 生成 session token │                   │
 │                        │                         │ 存 session:{stoken}   │                   │
 │                        │                         │ ─────────────────────────────────────►     │
 │                        │                         │ 5. Set-Cookie         │                   │
 │                        │  302 → /chat            │                       │                   │
 │◄────────────────────────│─────────────────────────│                       │                   │
```

**防邮件安全扫描器预取（一次性 token 的关键边界）**：企业邮箱/出口网关会自动 `GET` 邮件里的链接，若 `GET /auth/verify` 直接消费 token 并建 session，用户真点时会撞"链接已使用"。因此拆两步：

- `GET /auth/verify?token=xxx`：只校验 token 存在且未过期，**渲染一个"确认登录"落地页**（含一个 POST 按钮），**不消费 token、不建 session**。
- `POST /auth/verify`（按钮提交）：此时才删除 token（一次性）、创建/登录用户、生成 session、`Set-Cookie` 后 302。
- 扫描器只发 GET，拿不到 session；真人点按钮才登录。

**Session Cookie 安全属性**：`Set-Cookie: session_token=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`。`HttpOnly` 阻止 JS 读取（防 XSS 窃取）、`Secure` 仅 HTTPS、`SameSite=Lax` 兜住跨站 CSRF。token 为不可猜的随机串，本身不含用户信息。

### 3.2 Telegram 绑定

```
User                   Telegram Bot           Worker              PWA Session         D1
 │                         │                    │                     │                │
 │ /bind me@example.com    │                    │                     │                │
 │────────────────────────►│                    │                     │                │
 │                         │ 生成6位验证码      │                     │                │
 │                         │ 存 bind_code:xxx   │                     │                │
 │                         │── KV ─────────────►│                     │                │
 │                         │                    │                     │                │
 │                         │ 发邮件含验证码     │                     │                │
 │                         │── Resend ─────────►│                     │                │
 │                         │                    │                     │                │
 │  ✉️ 收到验证码          │                    │                     │                │
 │                         │                    │                     │                │
 │  在 PWA 验证页输入码    │                    │                     │                │
 │─────────────────────────│────────────────────│────────────────────►│                │
 │                         │                    │ POST /auth/bind     │                │
 │                         │                    │ { email, code }     │                │
 │                         │                    │◄────────────────────│                │
 │                         │                    │                     │                │
 │                         │                    │ 校验 code → 匹配    │                │
 │                         │                    │ UPDATE users SET    │                │
 │                         │                    │ telegram_id=xxx     │                │
 │                         │                    │ WHERE email=yyy     │                │
 │                         │                    │────────────────────►│                │
 │                         │                    │                     │                │
 │                         │   ✅ 绑定成功      │                     │                │
 │                         │◄───────────────────│                     │                │
```

**绑定前置与账号合并**（`POST /auth/bind` 校验码通过后）：

设 TG chat 为 `T`、目标邮箱账号为 `E`：

1. **邮箱账号必须先存在**：`/bind <email>` 时若 `users` 无 `email=<email>` 行，回复"请先在 PWA 用该邮箱登录注册后再绑定"，不发码。避免 `UPDATE ... WHERE email=` 影响 0 行的静默失败。
2. **目标邮箱已被别的 TG 绑定**：`E.telegram_id` 非空且 ≠ `T` → 拒绝，"该邮箱已绑定其他 Telegram"。
3. **情形 A（较少）**：`T` 在 `users` 中无独立行 → 直接 `UPDATE users SET telegram_id=T WHERE email=E`。（开放自助下 TG 用户首次发消息已自动建号，故此情形仅见于"从未在 TG 发过消息、直接来 PWA 绑定"。）
4. **情形 B（开放自助下的常见路径，账号合并）**：`T` 已有自己的 TG-only `users` 行 `U_t`（首次发消息时自动创建）且名下可能有数据 →
   - 先 `UPDATE users SET telegram_id=NULL WHERE id=U_t.id`（腾出 `telegram_id` 唯一约束）；
   - 把 `U_t` 名下数据改挂到 `E`：`UPDATE {vehicles,fuel_records,mileage_records,maintenance_records,reminders} SET user_id=E.id WHERE user_id=U_t.id`；
   - `UPDATE users SET status='merged' WHERE id=U_t.id`（失活，不物理删，可回溯）；
   - 最后 `UPDATE users SET telegram_id=T WHERE id=E.id`。
   - 全程在一个逻辑事务内（D1 batch），任一步失败整体回滚，避免数据半挂。

### 3.3 Session 管理

| 存储 | Key | Value | TTL |
|------|-----|-------|-----|
| Magic Link | `magic_link:{uuid}` | `{email, expires_at}` | 15 min |
| Session | `session:{token}` | `{user_id, email, created_at}` | 30 days |
| PWA 对话历史 | `session:pwa:{user_id}` | `Message[]` | 1 h |
| 绑定验证码 | `bind_code:{email}` | `{code, telegram_id}` | 10 min |

**滑动续期**：每次 session 校验通过后，若该 token 剩余 TTL < 7 天，则用原值重写 KV（`expirationTtl: 30d`）刷新有效期。活跃用户长期免重登，闲置满 30 天自然失效。续期是写操作，仅在跨过阈值时触发，避免每请求都写 KV。

Session 校验中间件（**鉴权在 API 层**，静态 SPA shell 不做服务端重定向，见 ADR-0010）：

```
静态资源请求（SPA shell / JS / css）：
    → [assets] 直接公开返回（壳内无用户数据，不校验）

API 请求（/chat/api、/api/v1/*、/auth/logout…）：
    → 有 Cookie: session_token=xxx?
        ↓ 否 → 401
        ↓ 是 → KV.get("session:xxx") → 有?
            ↓ 无（过期）→ 401
            ↓ 有 → 滑动续期 → 解析 user_id → 注入后续处理
    → 前端收到 401 → 客户端路由跳 /login（保留 redirect）

兼容旧仪表盘：/api/v1/* 额外接受 ?token=xxx（管理员，30 天过渡期）

例外 GET /auth/verify：邮件直达，Worker 返回最小服务端 HTML 确认页（非 SPA）
```

---

## 4. PWA 前端（web/ Svelte SPA）

> 决策见 [ADR-0010](../../engineering/adr/0010-frontend-svelte-spa-static-assets.md)。前端从 `dashboard-html.ts` 字符串模式迁出，独立成 `web/` 子项目，Vite + Svelte 构建成静态资源，由现有 Worker 经 `wrangler.toml` 的 `[assets]` 绑定托管。

### 4.1 项目结构与路由划分

```
web/                          # 新前端子项目（独立 package.json，devDeps：vite + svelte）
  public/
    manifest.json             # PWA manifest（静态文件，不再内联 Worker）
    icon-192.png / icon-512.png
  src/
    main.ts                   # SPA 入口，挂载根组件 + 客户端路由
    routes/
      Chat.svelte             # 对话主页（气泡 + 快捷面板 + 录音）
      Login.svelte            # 邮箱登录（POST /auth/send-link）
      Settings.svelte         # 语言 / 绑定状态 / 登出
      Dashboard.svelte        # 仪表盘（迁移边界见 §4.5）
    lib/
      api.ts                  # fetch 封装：带 cookie、统一 401 → 跳 /login
      session.ts              # 客户端登录态（来自 /api/v1/me）
      i18n.ts                 # 双语（?lang= / localStorage）
    components/
      TopBar.svelte  Bubble.svelte  QuickPanel.svelte  Recorder.svelte
    theme.css                 # 复用现有 dashboard 的 :root 设计 token
  vite.config.ts
  → npm run build → web/dist/（部署时由 [assets] 托管）
```

**路由划分**：客户端路由（SPA 内，刷新兜底到 `index.html`）vs 服务端端点（Worker 代码）：

| 路径 | 类型 | 由谁处理 | 说明 |
|------|------|---------|------|
| `/` `/login` `/chat` `/settings` `/dashboard` | 客户端路由 | `[assets]` → SPA shell | 公开返回壳，数据靠 API；SPA 内导航 |
| `/manifest.json` `/assets/*` `/icon-*.png` | 静态资源 | `[assets]` | Vite 构建产物 |
| `POST /auth/send-link` `/auth/bind` `/auth/logout` | 服务端 | `src/routes/auth-handler.ts` | JSON 进出 |
| `GET /auth/verify` / `POST /auth/verify` | 服务端 | `src/routes/auth-handler.ts` | GET=最小 HTML 确认页；POST=建 session（防预取，§3.1） |
| `POST /chat/api` `/chat/voice` | 服务端 | `src/routes/chat-api.ts` | session 鉴权 → Agent Loop |
| `GET /api/v1/*`（含新增 `/me`） | 服务端 | `src/routes/api.ts` | session/旧 token 鉴权 + `user_id` 过滤 |

> 不再有 `auth-html.ts` / `chat-html.ts` / `settings-html.ts` 这类返回 HTML 字符串的 Worker 路由——这些页面都是 `web/` 里的 `.svelte`。Worker 侧只剩**端点**。

### 4.2 对话界面设计（Chat.svelte）

核心功能：
- 消息气泡（用户右，Bot 左），带 emoji 和交互时间戳
- 底部输入栏 + 发送按钮 + 语音按钮 + 附件（Phase 4）
- 快捷面板（仪表盘 / 记加油 / 车辆管理 / 历史）
- 消息历史从 KV 加载（`session:pwa:{user_id}`），保留最近 10 条
- 滚动到底部、自动发送

```
┌─────────────────────────────────┐
│  🏍 Moto Bot           [⚙️]     │ ← 顶栏
├─────────────────────────────────┤
│                                 │
│  ┌──────────────────────────┐   │
│  │ ⛽ 已记录 5.2L           │   │
│  │ 本次油耗 2.8L/100km      │   │ ← Bot 消息（右对齐为灰色气泡）
│  │ 📊 点击查看仪表盘        │   │
│  └──────────────────────────┘   │
│                                 │
│             ┌───────────────┐   │
│             │ 加了5升95花50 │   │ ← 用户消息（左对齐为蓝色气泡）
│             │       14:30   │   │
│             └───────────────┘   │
│                                 │
│  ┌──────┐ ┌──────┐ ┌───────┐   │
│  │ 📊   │ │ ⛽   │ │ 🚗    │   │ ← 快捷操作卡片
│  │仪表盘│ │记加油│ │车辆管理│   │
│  └──────┘ └──────┘ └───────┘   │
│                                 │
│  ┌─────────────────────────┐    │
│  │ 输入加油记录...    🎤   │    │ ← 输入行（+语音）
│  └─────────────────────────┘    │
│                         [发送]  │
└─────────────────────────────────┘
```

### 4.3 语音输入

`Recorder.svelte`（浏览器侧）：
```
navigator.mediaDevices.getUserMedia({audio: true})
  → MediaRecorder → chunks → Blob (webm/opus)
  → POST /chat/voice (multipart/form-data, 带 cookie)
```

Worker 侧（`chat-api.ts`）：
```
接收录音 → 校验 session → 调 stt.ts 的 transcribe()（Whisper 支持 webm/opus）
  → 转文字 → 注入 user_id → 走现有 Agent Loop → 返回 { text, reply }
```

### 4.4 PWA Manifest

`web/public/manifest.json`（**静态文件**，由 Vite 原样产出到 `dist/`，不再内联 Worker）；图标用真实 PNG（部分平台安装需要，避免 SVG/MIME 坑）：

```json
{
  "name": "Moto Bot — 摩托车油耗管家",
  "short_name": "Moto Bot",
  "description": "用对话或语音记录加油，自动计算油耗",
  "start_url": "/chat",
  "display": "standalone",
  "background_color": "#111827",
  "theme_color": "#f59e0b",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

### 4.5 仪表盘迁移边界

仪表盘最终成为 SPA 的一个路由（`Dashboard.svelte`），但为**控制本期范围**分两步：

- **本期**：先打通 `Chat` / `Login` / `Settings` 三页 + 鉴权；现有 `src/routes/dashboard-html.ts` **暂保留可用**，`Dashboard.svelte` 可先用 `<iframe>` 或外链指向旧 `/dashboard`，SPA 顶栏/快捷面板能跳过去即可。
- **后续**：把图表逻辑迁进 `Dashboard.svelte`、消费 `/api/v1/*`，删除 `dashboard-html.ts`。
- **两期都要做**：`src/routes/api.ts` 的 `/api/v1/*` 加 session cookie 鉴权（旧 `token=` 30 天过渡）+ `user_id` 过滤——这是数据隔离的一部分，不可延后（见 §5）。

---

## 5. 数据隔离（database.ts 改动）

隔离是**安全边界**，按以下三原则收口，不留"按需再改"的灰区：

1. **直接列、不靠 JOIN**：所有读/写都按记录自身的 `user_id` 过滤。不依赖 `vehicle_id → vehicles.user_id` 关联——那样 `vehicle_id IS NULL` 的孤儿记录会落在隔离之外（跨用户泄露）。写入时 `user_id` 与 `vehicle_id` 同时落库。
2. **默认拒绝**：每个读函数**必须**接收 `userId` 且 WHERE 带 `user_id = ?`。**没有 `userId` 的读查询一律视为 bug**（code review / 测试卡死）。宁可多传一个参数，不可漏过滤。
3. **来源单一**：`userId` 一律由中间件解析后显式传入数据层，不在数据层内部猜。
   - Telegram 入口：`chat_id` → `getUserByTelegramId` → `user.id`
   - PWA 入口：session cookie → `session.user_id`

### 关键变更函数（一次性全量收口，非渐进）

| 函数 | 变更 |
|------|------|
| `insertFuelRecord` / `insertMileageRecord` / `insertMaintenanceRecord` | 新增 `user_id` 参数，落库 |
| `insertVehicle` / `getVehicles` | 新增 / 改为带 `user_id` 参数，替代全量查询 |
| `getLastFuelRecord(vehicleId, userId)` | 加 `user_id = ?` |
| `getRecentFuelRecords(limit, userId)` | 加 `user_id = ?`（直接列，非 JOIN） |
| `getFuelRecordsByDateRange(since, until, userId)` | 加 `user_id = ?`（直接列，非 JOIN） |
| `getLatestOdometer` / `getMaintenanceRecords` / `findFuelRecords` / `findMaintenanceRecords` 等所有定位/读取 | 加 `user_id = ?` |
| `queryStats(...)` | 经 `getFuelRecordsByDateRange` 链式传递 `userId` |
| `reminders` 读取（cron 除外）| 加 `user_id = ?` |

> 工具层（`src/tools/`）由 `dispatchTool` 注入当前 `user_id`（见 §12），不暴露给 LLM。
> cron（`scheduled.ts`）是唯一**跨用户**读取 `reminders` 的路径，见 §16。

---

## 6. 中间件设计

静态 SPA 模式下**没有页面级服务端重定向**（ADR-0010）：`[assets]` 把 SPA shell 公开返回，鉴权只在 **API 端点**做，无效 session 一律 **401**，由前端 `lib/api.ts` 统一捕获后客户端跳 `/login`。

### 6.1 API 鉴权中间件（解析 user，不重定向）

```typescript
// 仅对 API 端点调用（/chat/*、/api/v1/*、/auth/logout…）；静态资源由 [assets] 先行接管
async function resolveSession(request, env): Promise<Session | null> {
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie.match(/session_token=([^;]+)/)?.[1];

  if (token) {
    const raw = await env.SESSION_KV.get(`session:${token}`);
    if (raw) {
      const session = JSON.parse(raw);
      await maybeRenew(env, token, session);   // 滑动续期（§3.3）
      return session;
    }
  }
  return null;   // 调用方据此返回 401
}
```

调用方模式：`const s = await resolveSession(req, env); if (!s) return json(401, {error:'unauthorized'});`

> **GET /auth/verify 例外**：邮件链接直达，不是 API、也不属 SPA——由 `auth-handler.ts` 返回最小服务端 HTML 确认页（含 POST 按钮），防安全网关预取（§3.1）。

> **CSRF**：Cookie 自动携带凭证，所有改状态端点（`POST /chat/api`、`/chat/voice`、`/auth/*`）靠 `SameSite=Lax` 兜底，并校验 `Origin`/`Referer` 同源；`GET` 无副作用。

### 6.2 仪表盘 API 兼容鉴权

```typescript
// src/routes/api.ts 的 /api/v1/*：
// 1. resolveSession(cookie) → 有则用 session.user_id（PWA 路径）
// 2. 否则回退旧 ?token= 比对（管理员，30 天过渡期）→ 管理员 user_id
// 3. 都没有 → 401
// 解析出的 user_id 传给所有查询函数（§5 默认拒绝）
```

---

## 7. Resend 集成

> MailChannels 对 Cloudflare Workers 的免费发信已于 2024-08-31 终止，改用 Resend 免费层（100 封/天）。需 `RESEND_API_KEY`（secret）+ 在 Resend 验证 `SENDER_EMAIL` 所属域名（SPF/DKIM/DMARC DNS，一次性）。

封装在 `src/services/mail.ts`，两类邮件（Magic Link / 绑定验证码）共用底层 `sendEmail`：

```typescript
async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: `Moto Bot <${env.SENDER_EMAIL}>`,  // 须属于 Resend 已验证域名
      to: [to],
      subject,
      text,
    }),
  });

  if (!resp.ok) {
    console.error('[mail] resend send failed:', resp.status, await resp.text());
    throw new Error('邮件发送失败');
  }
}

async function sendMagicLinkEmail(env: Env, email: string, link: string): Promise<void> {
  await sendEmail(env, email, '🔑 Moto Bot 登录链接',
    `点击以下链接登录 Moto Bot（15 分钟内有效）：\n\n${link}\n\n如果非本人操作，请忽略此邮件。`);
}

async function sendBindCodeEmail(env: Env, email: string, code: string): Promise<void> {
  await sendEmail(env, email, '🔗 Moto Bot 绑定验证码',
    `你的绑定验证码是 ${code}（10 分钟内有效）。\n请在 PWA 设置页输入完成 Telegram 绑定。\n\n如果非本人操作，请忽略此邮件。`);
}
```

> `RESEND_API_KEY` 经 `wrangler secret put RESEND_API_KEY` 注入，绝不进 git（CLAUDE.md §2 黄金法则 7）。本地开发放 `.dev.vars`。

---

## 8. 流程 / 时序

### PWA 完整对话流程

```
User                    PWA Worker                    Agent Loop                    D1/KV
 │                         │                              │                         │
 │ POST /chat/api          │                              │                         │
 │ { text: "加5升95花50"}  │                              │                         │
 │────────────────────────►│                              │                         │
 │                         │ 解析 session_token → user_id │                         │
 │                         │──────────────────────────────│                         │
 │                         │ 读对话历史                    │                         │
 │                         │ session:pwa:{user_id}        │                         │
 │                         │───────────────────────────────────────────────────────►│
 │                         │                              │                         │
 │                         │ messages.push(user_msg)      │                         │
 │                         │ runAgentLoop(messages, ...)  │                         │
 │                         │──────────────────────────────►                         │
 │                         │                              │                         │
 │                         │ ← 调 log_fuel 工具 ──────────│                         │
 │                         │──────────────────────────────►—— db.insertFuelRecord ─►│
 │                         │                              │                         │
 │                         │ ← 返回 "已记录 5.2L，..."    │                         │
 │                         │◄─────────────────────────────│                         │
 │                         │                              │                         │
 │                         │ 持久化对话历史                │                         │
 │                         │───────────────────────────────────────────────────────►│
 │                         │                              │                         │
 │ 返回 { reply }         │                              │                         │
 │◄────────────────────────│                              │                         │
 │                         │                              │                         │
 │ 渲染 Bot 气泡           │                              │                         │
```

---

## 9. 边界与错误处理

| 场景 | 处理 |
|------|------|
| 邮箱输入格式不对 | 前端校验 + 后端二次校验，返回可读错误 |
| Resend 发信失败 | 返回"邮件发送失败，请稍后重试"，日志记录 status + body |
| Resend 当日 100 封超限 | 返回"今日发信达上限，请稍后再试"，日志告警；接近上限考虑升档 |
| 发信被刷（同邮箱/IP 高频） | `email+IP` 限流命中 → "请求过于频繁，请稍后再试"，不发信 |
| 邮件安全网关预取链接 | `GET /auth/verify` 仅渲染确认页、不消费 token；真人 POST 才登录 |
| Magic Link 已被使用 | 显示"此链接已使用过，请重新申请" |
| Magic Link 过期 | 显示"链接已过期，请重新申请"，返回登录页 |
| 绑定目标邮箱未注册 | `/bind` 回复"请先在 PWA 用该邮箱登录注册后再绑定" |
| 绑定时账号合并冲突 | 合并在 D1 batch 事务内，先清旧 `telegram_id` 再迁数据，失败整体回滚 |
| Session token 过期 | 静默跳转到登录页（保留返回路径） |
| 语音录音权限被拒 | 按钮置灰，提示"请在浏览器设置中允许麦克风" |
| 语音识别失败 | 返回"没听清，请打字或再录一次" |
| Telegram 绑定邮箱已存在 | 返回"该邮箱已被其他账号绑定" |
| 多设备同时登录 | 都允许（共享 user_id，独立 session） |
| 无可用车辆 | 对话页显示"请先在 Bot 或车辆管理添加车辆" |
| 数据库查询异常 | 工具层 try/catch，返回可读中文错误 |
| 并发登录冲突 | KV 事务保障（单 key 原子操作） |

---

## 10. 存量数据迁移

迁移 `0009` 建表/加列后，跑一次性数据迁移脚本 `scripts/migrate-single-user.ts`（幂等，可重跑），把存量单用户数据归到管理员。`ALLOWED_CHAT_ID` 作为参数传入（`?`）：

```sql
-- Step 1: 创建管理员用户（ALLOWED_CHAT_ID 对应的用户）
INSERT INTO users (telegram_id, email, nickname, lang, is_admin)
VALUES (?, NULL, 'Admin', 'zh', 1)
ON CONFLICT(telegram_id) DO NOTHING;

-- 取管理员 id（后续步骤复用）
-- adminId = SELECT id FROM users WHERE telegram_id = ?

-- Step 2: 把所有归属未定的存量数据挂到管理员（只填空，不覆盖已有 user_id）
UPDATE vehicles            SET user_id = :adminId WHERE user_id IS NULL;
UPDATE fuel_records        SET user_id = :adminId WHERE user_id IS NULL;
UPDATE mileage_records     SET user_id = :adminId WHERE user_id IS NULL;
UPDATE maintenance_records SET user_id = :adminId WHERE user_id IS NULL;

-- Step 3: reminders 归属填 user_id —— chat_id 保持原值不动（cron 推送目标）
UPDATE reminders SET user_id = :adminId WHERE user_id IS NULL;
```

> **关键纠正**：旧方案曾把 `reminders.chat_id` 原地改写成 `user_id`，会让 cron 的 `sendMessage(Number(chat_id))` 推到不存在的会话、提醒静默失效，且违反"只增不删"。现改为：归属走**新列 `user_id`**，`chat_id`（Telegram 推送目标）**原值保留**。
> 幂等性：所有 `UPDATE ... WHERE user_id IS NULL` 二次运行不再命中行；`INSERT ... ON CONFLICT DO NOTHING` 重跑无副作用。

---

## 11. 兼容性策略

| 方面 | 策略 |
|------|------|
| 旧 Telegram 用户 | 数据自动归属管理员账户，零感知 |
| 旧 Dashboard token | token 参数继续有效（管理员访问），PWA 用户使用 session cookie |
| `/api/v1/*` 端点 | 适配 session 鉴权，旧 token 兼容 30 天过渡期 |
| 旧 `ALLOWED_CHAT_ID` | 保留为管理员标识，**不再做访问门控** |
| 陌生人从 Telegram 首次使用 | **开放自助**：`chat_id` → `getOrCreateTelegramUser` 自动建一个 TG-only 账号（`telegram_id`，email 空）并提供服务，数据按 `user_id` 隔离。成本由每用户限流兜底（无总量配额，见安全章风险）|
| 新用户从 PWA 首次使用 | 创建 `users` 记录（email 主键，telegram_id 暂空）——邮箱是另一条注册入口 |
| 已有账号用户从 Telegram 使用 | `chat_id` → `getUserByTelegramId` 命中既有账号 → 正常服务，数据按 `user_id` 隔离 |

---

## 12. 工具契约变更

| 工具 | 变更 | 参数 | 返回 |
|------|------|------|------|
| `log_fuel` | 自动从 session 取 `user_id`，不再需要用户提供 | 不变 | 不变 |
| `log_mileage` | 同上 | 不变 | 不变 |
| `log_maintenance` | 同上 | 不变 | 不变 |
| `query_stats` | 同上 | 不变 | 不变 |
| `get_last_record` | 同上 | 不变 | 不变 |
| `create_vehicle` | 同上 | 不变 | 不变 |
| 所有工具 | 在执行时注入当前 `user_id` | 不变 | 不变 |

> 工具层对 `user_id` 的处理在 `dispatchTool` 注入而非在 prompt 中暴露给 LLM。

---

## 13. Prompt 影响

System prompt 新增一段说明（中英文版）：

```
中文版新增：
- 系统现支持多用户，每位用户的数据独立隔离。
- 你不需要关心用户 ID，系统会自动识别当前用户。
- 新增的 /bind 命令用于绑定 Telegram 和 PWA 账号。

英文版新增：
- The system now supports multiple users with isolated data.
- User ID is automatically resolved — you don't need to handle it.
- The /bind command links Telegram and PWA accounts.
```

---

## 14. 风险与权衡

| 风险 | 缓解 |
|------|------|
| Resend 邮件被标记为垃圾邮件 | 在 Resend 验证域名并配置 SPF/DKIM/DMARC；文案标明发件源；监控退信率 |
| Resend 免费层 100 封/天被打满 | `email+IP` 限流挡滥用；日志告警；超量时升 Resend 付费档或换 provider（ADR） |
| 发信端点被当成邮件轰炸/反射器 | `/auth/send-link`、`/bind` 按 `email+IP` 限流（如 5 次/15min）；匿名也限 |
| Session token 被窃取 | `HttpOnly; Secure; SameSite=Lax` cookie，JS 读不到、仅 HTTPS、防 CSRF；token 随机不含用户信息，过期即废 |
| KV 最终一致性可能导致短时 session 不一致 | Session token 在 KV 写入后秒级可见，可接受；Magic Link 要求 token 存在才有效 |
| 多用户后 LLM 成本上升 | **已改为开放自助**（任何 TG 用户自动建号、可用）：当前仅靠每用户限流兜底，**无总量/人均配额**——成本对公众敞口。后续需加：全局日配额、新用户冷却、可疑用量告警，必要时回退到准入名单 |
| database.ts 带 user_id 影响范围大 | **一次性全量收口**（安全边界不做渐进）：所有读路径强制 `userId`，缺失即测试失败，杜绝漏过滤泄露 |
| cron 多用户后推错人 | `reminders.chat_id` 保留为推送目标、新增 `user_id` 仅作归属；cron 按 chat_id 推、按用户 lang 取文案（§16） |

---

## 15. 测试要点

> 对应 [testing-strategy](../../engineering/testing-strategy.md)。

| 维度 | 测试 |
|------|------|
| 认证流程 | Magic link 生成/验证/过期/一次性；session 创建/过期/滑动续期 |
| 防预取 | `GET /auth/verify` 不消费 token、不建 session；`POST /auth/verify` 才登录 |
| 数据隔离 | 用户 A 创建记录后 B 查询不到；`vehicle_id` 为空的孤儿记录也只对属主可见；读函数缺 `userId` 时测试失败 |
| 账号合并 | TG-only 账号 `/bind` 到邮箱账号 → 数据改挂、旧号 `status=merged`、唯一约束不冲突 |
| PWA 对话 | POST /chat/api 带 session → 返回回复；不带 session → 401 |
| Telegram 绑定 | /bind → 验证码（mock Resend）→ POST /auth/bind 正确/错误码 → 关联/拒绝 |
| 邮箱未注册先绑定 | /bind 未注册邮箱 → 提示先注册、不发码 |
| 语音 | 模拟录音上传 → Whisper mock → 回复 |
| 存量迁移 | 空库迁移、有数据迁移、重复迁移幂等；`reminders.chat_id` 不被改写 |
| cron 多用户 | 多用户各有到期提醒 → 按各自 chat_id 推送、按 lang 取文案 |
| 兼容性 | 旧 Dashboard token 仍能访问管理员数据 |
| 限流 | `/auth/send-link`、`/bind` 按 `email+IP` 5 次/15min 限制 |

---

## 16. cron（scheduled.ts）多用户化

现状：`src/scheduled.ts` 无用户上下文，到期提醒 `const target = r.chat_id ?? env.ALLOWED_CHAT_ID` 后 `bot.api.sendMessage(Number(target), text)`，文案默认中文。多用户后需要：

- **推送目标**：仍用 `reminders.chat_id`（未设置则回退该 reminder 属主用户的 `users.telegram_id`，最后才回退 `ALLOWED_CHAT_ID`）。未绑定 TG 的纯 PWA 用户暂不推送（Phase 4 加站内/邮件提醒）。
- **文案语言**：按属主 `users.lang` 选 `zh/en`（经 `reminders.user_id → users.lang`），不再硬编码中文。
- **自动续期**：续期写回的新 reminder 继承原 `user_id` 与 `chat_id`。
- **隔离豁免**：cron 是唯一合法跨用户读 `reminders` 的路径（扫全表找到期项），但每条推送严格按该行 `user_id`/`chat_id` 定向，不串号。

> 对应任务见 tasks T 序列新增的「cron 多用户化」条目。
