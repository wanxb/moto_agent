# 任务：多用户 PWA — 邮箱认证 + 对话式 Web 界面

> 规格 016 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)

---

## 任务清单

> 顺序：数据模型→数据访问→认证→前端脚手架/API 鉴权→对话界面→语音→绑定→登录/设置页→manifest→仪表盘→cron→迁移→测试→部署。
> 前端从 `dashboard-html.ts` 字符串模式迁出，独立成 `web/` Svelte SPA，由 Worker 经 `[assets]` 托管（[ADR-0010](../../engineering/adr/0010-frontend-svelte-spa-static-assets.md)）。
> 每条勾选前确认其验证项通过。

### T1 数据模型 — users 表 + 各表 user_id

> 迁移号用 **`0009`**（`0008` 已被 spec 017 占用且已上线）。

- [ ] **T1.1** 创建迁移 `migrations/0009_multi_user.sql`：
  - `CREATE TABLE IF NOT EXISTS users`（含 `status`，见 design §2）
  - `ALTER TABLE` 给 `fuel_records`/`mileage_records`/`maintenance_records`/`reminders` 各加 `user_id INTEGER`（`vehicles` 已有）
  - 建 `idx_*_user` 索引
  - 头部注释：`ADD COLUMN` 非幂等，重复执行报 `duplicate column` 即已迁移
- [ ] **T1.2** 同步 `docs/schema.sql`：`users` 表 + 四张表的 `user_id` 列与索引
- [ ] **T1.3** 同步 `test/utils.ts` 建表语句（含 `user_id`）
- [ ] **T1.4** 同步 `src/types.ts`：新增 `User` 接口；`FuelRecord`/`MileageRecord`/`MaintenanceRecord`/`Reminder` 加 `user_id`
  - 验证：`npm run db:init` 成功；空库 + 有数据库迁移后表结构正确

### T2 数据访问层 — database.ts

- [ ] **T2.1** 新增 `getUserByEmail(email)` / `getUserByTelegramId(tgId)` / `createUser(email?, telegramId?)` / `updateUserLastLogin(id)`
- [ ] **T2.2** 新增 `bindTelegramToUser(email, telegramId)`：含**账号合并**（design §3.2 情形 B），D1 batch 事务内先清旧 `telegram_id`、迁移数据、旧号 `status='merged'`
- [ ] **T2.3** 新增 `getVehicles(userId)` / `insertVehicle(..., userId)`（替代无参数版本）
- [ ] **T2.4** 改造写入函数 `insertFuelRecord` / `insertMileageRecord` / `insertMaintenanceRecord`，增加 `user_id` 参数并落库
- [ ] **T2.5** **一次性全量收口**所有读路径加 `user_id = ?`（非渐进）：`getLastFuelRecord`、`getRecentFuelRecords`、`getFuelRecordsByDateRange`、`getLatestOdometer`、`getMaintenanceRecords`、`findFuelRecords`、`findMaintenanceRecords`、reminders 读取（cron 除外）等。直接列过滤、不靠 JOIN
  - 验证：`database.test.ts` 覆盖隔离 + 孤儿记录（`vehicle_id IS NULL`）仍按 `user_id` 隔离

### T3 认证系统 — Magic Link + Session

- [ ] **T3.1** 创建 `src/routes/auth-handler.ts`：
  - `POST /auth/send-link`：`email+IP` 限流 → 生成 token → KV 存 15min → 调 Resend 发邮件
  - `GET /auth/verify?token=`：仅校验存在/未过期，**渲染确认页**（不消费 token、不建 session，防扫描器预取）
  - `POST /auth/verify`：消费 token（一次性）→ 创建/登录用户 → 生成 session → `Set-Cookie`(HttpOnly;Secure;SameSite=Lax) → 302
  - `POST /auth/logout`：清除 KV 中的 session
  - `POST /auth/bind`：`email+IP` 限流 → 验证绑定码 → `bindTelegramToUser`（含合并）
- [ ] **T3.2** 实现 `src/services/mail.ts`：基于 **Resend**（`sendEmail`/`sendMagicLinkEmail`/`sendBindCodeEmail`，见 design §7）
- [ ] **T3.3** 实现 session 生成/校验/**滑动续期**逻辑（剩余 TTL <7 天则刷新到 30 天）
- [ ] **T3.4** 实现发信端点限流：复用/扩展 `src/gateway/rate-limiter.ts`，按 `email+IP` 5 次/15min
- [ ] **T3.5** 在 Resend 后台验证发件域名 + 配置 SPF/DKIM/DMARC（一次性）；`wrangler secret put RESEND_API_KEY`
  - 验证：手动发邮件测试，检查收件箱（非垃圾箱）
  - 验证：扫描器 GET verify 不登录；POST verify 才登录；过期/重复 token 被拒
  - 验证：超频申请被限流

### T4 前端脚手架（web/）+ API 鉴权中间件

> SPA 模式：页面公开，鉴权只在 API 端点（401，不做服务端重定向，ADR-0010）。

- [ ] **T4.1** 脚手架 `web/`：独立 `package.json`（devDeps：`vite` + `svelte` + `@sveltejs/vite-plugin-svelte` + `svelte-check`）、`vite.config.ts`、`src/main.ts` 入口 + 客户端路由
- [ ] **T4.2** `web/src/theme.css`：把现有 `dashboard-html.ts` 的 `:root` 设计 token（`--bg/--card/--accent`…）抽出复用；移动端优先 + 安全区
- [ ] **T4.3** `web/src/lib/api.ts`：fetch 封装（默认带 cookie），统一拦截 **401 → 客户端跳 `/login`**；`session.ts` 拉 `/api/v1/me` 判登录态
- [ ] **T4.4** `wrangler.toml` 加 `[assets]`（`directory = "./web/dist"`）；`src/index.ts` 让动态路由（`/auth/*`、`/chat/*`、`/api/*`、`/telegram`）优先，其余交 `[assets]`
- [ ] **T4.5** `src/index.ts` 新增 `resolveSession()`：解析 cookie → KV → user，**无效返回 401**（不重定向）；滑动续期
  - 验证：未登录 `POST /chat/api` → 401；前端据此跳 `/login`
  - 验证：`npm run build`（web）产出 `web/dist`；`wrangler dev` 能同时吐 SPA + 跑 API
  - 验证：旧 Dashboard `?token=` 仍可用

### T5 对话界面（Chat.svelte + chat-api.ts）

- [ ] **T5.1** 前端 `web/src/routes/Chat.svelte` + 组件 `Bubble.svelte` / `QuickPanel.svelte` / `TopBar.svelte`：
  - 移动端优先，深色主题（复用 `theme.css`）
  - 气泡：用户右对齐（蓝），Bot 左对齐（灰），带时间戳
  - 底部固定输入栏 + 发送 + 语音按钮
  - 快捷卡片：📊 仪表盘、⛽ 记加油、🚗 车辆管理、📋 历史
  - 挂载时 `GET /chat/api?history=1` 拉历史；发送后滚到底
  - `?lang=en` / localStorage 双语（`i18n.ts`）
- [ ] **T5.2** 后端 `src/routes/chat-api.ts`（Worker 端点，非 HTML）：
  - `POST /chat/api`：`resolveSession`→401 守卫 → 读 `session:pwa:{user_id}` → 注入 `user_id` 调 Agent Loop → 写回 KV → `{ reply }`
  - `POST /chat/voice`：multipart 录音 → Whisper → 同文字链路 → `{ text, reply }`
  - `GET /chat/api?history=1`：返回最近对话历史
- [ ] **T5.3** PWA 对话历史独立于 Telegram 会话（KV key `session:pwa:{user_id}`，TTL 1h）
  - 验证：发送 → 返回回复并存历史 → 刷新页面历史加载正确
  - 验证：不干扰 Telegram 端会话

### T6 语音输入

- [ ] **T6.1** 前端录音组件 `web/src/components/Recorder.svelte`：
  - `navigator.mediaDevices.getUserMedia` → MediaRecorder
  - 录音按钮 UI（按住录音 / 松开发送）
  - 录音结束后上传 `FormData` 到 `/chat/voice`
- [ ] **T6.2** 后端 `/chat/voice` 处理：
  - 接收音频 blob → 调 `stt.ts` transcribe() → 走 Agent Loop
  - 返回 `{ text: "识别结果", reply: "Bot回复" }`
  - 验证：模拟录音上传 → 得到文字回复
  - 验证：浏览器权限拒绝 → 按钮置灰提示

### T7 Telegram 绑定 `/bind` + 开放自助访问

> **访问模型修订（2026-06-26）**：去掉 `ALLOWED_CHAT_ID` 白名单门控，改为**开放自助**——任何 TG 用户首次发消息即由管道 `resolveUserId → getOrCreateTelegramUser` 自动建号，数据按 `user_id` 隔离。`/bind` 因此以**账号合并**（情形 B）为常见路径。成本仅靠每用户限流兜底，无总量配额（见 design 安全章风险）。

- [x] **T7.0** 开放自助接线（原 T5-D）：
  - `database.ts` 新增 `getOrCreateTelegramUser`（幂等 + 并发撞 UNIQUE 回查）
  - `pipeline.ts` `PipelineContext` 加 `resolveUserId` 钩子，注入 agent 实现隔离
  - `bootstrap.ts` 接上 `resolveUserId`（空标识 → undefined，保单用户兼容）
  - `index.ts` 移除白名单中间件（端点仍受 webhook secret 保护）
- [x] **T7.1** 在 `bot.on('message:text')` 之前新增 `/bind` 命令 handler：
  - 参数校验（邮箱格式）
  - **前置检查**：`getUserByEmail` 不存在 → 回复"请先在 PWA 用该邮箱注册后再绑定"，不发码
  - `email+chatId` 限流（TG 无 IP）
  - 生成 6 位验证码 → 存 `bind_code:{email}`（值含 `telegram_id`，10 分钟 TTL）
  - 通过 **Resend** 发验证码邮件
  - 回复用户"验证码已发送到邮箱"
- [x] **T7.2** 实现验证码校验（`POST /auth/bind`，用户在 PWA 设置页输码）：
  - 校验 `bind_code:{email}` 匹配且未过期、`telegram_id` 一致
  - 调 `bindTelegramToUser`：情形 A 直接挂载；情形 B **账号合并**（迁数据、旧号失活，design §3.2）
  - 校验失败/邮箱已被他人绑定 → 可读错误
  - 验证：/bind → 收邮件 → PWA 输码 → 绑定/合并成功 → TG 和 PWA 数据一致

### T8 登录页 + 设置页（Svelte 路由）

- [x] **T8.1** `web/src/routes/Login.svelte`（T5-C 已建，本期沿用）：
  - 品牌 Logo + 邮箱输入框 + "发送登录链接"（`POST /auth/send-link`）+ 使用说明
  - 发送成功态："邮件已发送，请检查收件箱"
  - 注：`GET /auth/verify` 确认页是 Worker 返回的最小服务端 HTML（防预取），**不在 SPA 内**
  - **决策**：绑定验证码输入移到 Settings（登录态下才合理，邮箱自动取自 `/api/v1/me`），不放 Login
- [x] **T8.2** `web/src/routes/Settings.svelte`：
  - 当前用户信息（邮箱、绑定状态，来自 `/api/v1/me`）
  - 语言切换（中/英）：即时切 UI（localStorage）+ 持久化到 `users.lang`（新增 `POST /api/v1/me {lang}`，否则对话回复语言与 UI 不一致）
  - Telegram 绑定：未绑定 → 6 位验证码输入 `POST /auth/bind`，成功后刷新状态；已绑定 → 显示状态
  - **解绑暂不开放**（无后端端点，显示提示文案而非假按钮，留后续）
  - 登出按钮（`POST /auth/logout` → 跳 `/login`）
  - 验证：正确显示用户信息；语言切换即时生效并持久化

### T9 PWA manifest + 安装支持

- [x] **T9.1** `web/public/manifest.json`（静态文件，Vite 原样产出，见 design §4.4）
- [x] **T9.2** SPA `index.html` `<head>` 加 `<link rel="manifest">` + `<meta name="theme-color" content="#f59e0b">` + SVG emoji favicon
- [x] **T9.3** 生成真实 PNG 图标 `web/public/icon-192.png` / `icon-512.png`（`purpose: any maskable`）：脚本 `scripts/make-icons.mjs`（sharp 渲染几何 SVG，无字体依赖）
  - 验证：手机 Chrome 打开 → "添加到主屏幕" → 安装后全屏打开、显示图标（需真机点验）

### T10 仪表盘适配（API 鉴权 + 迁移边界）

- [x] **T10.1** 修改 `src/routes/api.ts`：`/api/v1/*` 支持 session cookie 鉴权（`resolveApiUser`）+ 旧 `?token=` 兼容（30 天过渡）+ 所有查询加 `user_id` 过滤；`GET /api/v1/me` 已建（T4），本期加 `POST /api/v1/me {lang}`（T8）
- [x] **T10.2** 仪表盘**一步迁入 SPA**（用户拍板跳过 iframe 过渡）：
  - `web/src/routes/Dashboard.svelte` 消费 `/api/v1/*`：车辆 tabs + 天数筛选 + 汇总卡片 + Chart.js(npm 打包) 图表 + 加油/维保/提醒三段分页 + 双语
  - SPA 路由 `/dashboard` 接管；移除 Worker `GET /dashboard → dashboardPage`；**删除 `src/routes/dashboard-html.ts`**（612 行）
  - Chart.js 改 **npm 依赖**（不再 CDN 动态加载，防墙）；bundle gzip ~22KB→~97KB
  - 验证：PWA 登录后进 `/dashboard` 看本人数据；`?token=` API 仍可看管理员数据（旧 HTML 页已不存在）

### T10B cron 多用户化 — scheduled.ts

- [ ] **T10B.1** 改造 `src/scheduled.ts`：到期提醒推送目标 = `reminders.chat_id` → 回退该 reminder 属主 `users.telegram_id` → 回退 `ALLOWED_CHAT_ID`
- [ ] **T10B.2** 文案按属主 `users.lang`（经 `reminders.user_id → users.lang`）选 zh/en，去掉硬编码中文
- [ ] **T10B.3** 自动续期写回的新 reminder 继承原 `user_id` 与 `chat_id`；未绑 TG 的纯 PWA 用户暂不推送
  - 验证：多用户各有到期项 → 各按自己 chat_id/lang 收到，不串号

### T11 存量数据迁移脚本

> 表结构迁移（`0009_multi_user.sql`）见 T1.1，本节只做**数据**迁移脚本。

- [ ] **T11.1** 创建 `scripts/migrate-single-user.ts`：
  - 读 `ALLOWED_CHAT_ID` → 在 users 表 `INSERT ... ON CONFLICT DO NOTHING` 创建管理员
  - 将 `vehicles`/三张记录表/`reminders` 中 `user_id IS NULL` 的行回填管理员 `user_id`
  - **`reminders.chat_id` 保持原值不动**（cron 推送目标），只填新列 `user_id`
  - 幂等（`WHERE user_id IS NULL` 重跑不再命中）
- [ ] **T11.2** 测试迁移脚本：空库 → 正常；有数据 → 数据正确归属
  - 验证：迁移后所有车辆/记录/提醒都有正确 `user_id`，且 `reminders.chat_id` 未被改写

### T12 测试覆盖

- [ ] **T12.1** 认证流程测试（mock Resend `fetch`）：
  - send-link → KV 存 token → verify → 用户创建 → session 生成
  - token 过期 → 拒绝
  - 重复 verify → 拒绝（一次性）
- [ ] **T12.2** 数据隔离测试：
  - 创建用户 A + B + 各自车辆 + 加油记录
  - 用户 A 查询不到 B 的数据
  - 用户 B 查询不到 A 的数据
- [ ] **T12.3** PWA 对话测试（mock Agent Loop）：
  - POST /chat/api → 调用 Agent → 返回 reply
  - 无 session → 401
  - 历史加载 → 正确返回最近对话
- [ ] **T12.4** 语音测试：mock 录音 → 调 stt → 返回转写文本
- [ ] **T12.5** 绑定测试：
  - /bind → 生成验证码 → POST /auth/bind(正确code) → 绑定成功
  - POST /auth/bind(错误code) → 拒绝
- [ ] **T12.6** 兼容性测试：
  - 旧 Dashboard token 参数仍然可用（查看管理员数据）
  - 所有已有测试不受影响
  - 验证：`npm test` 全绿

### T13 文档与部署

- [ ] **T13.1** 更新 `docs/schema.sql`（最终版）
- [ ] **T13.2** 更新 `docs/engineering/data-model.md`（users 表 + 多用户隔离说明）
- [ ] **T13.3** 更新 `docs/engineering/security.md`（多用户安全章节落地）
- [ ] **T13.4** 更新 `docs/engineering/architecture.md`（新增 auth 端点 + `web/` SPA + `[assets]` 托管；引用 [ADR-0010](../../engineering/adr/0010-frontend-svelte-spa-static-assets.md)）
- [ ] **T13.5** 更新 `CLAUDE.md`：代码地图加 `web/` 与 auth/chat 端点；常用命令加前端构建（`npm --prefix web run build` / dev）；§7 说明前端 devDeps 不算 Worker 生产依赖
- [ ] **T13.6** 更新 `docs/specs/README.md` 索引（标记本 spec 状态）
- [ ] **T13.7** 新增 `SENDER_EMAIL`（var）到 `.dev.vars.example` / `wrangler.toml`；`RESEND_API_KEY` 走 `wrangler secret put`；`wrangler.toml` 加 `[assets]` 指向 `web/dist`
- [ ] **T13.8** 部署：

  1. `npm run type-check && npm test`（Worker）+ `npm --prefix web run build` 全绿
  2. 上线迁移 `wrangler d1 execute DB --remote --file=migrations/0009_multi_user.sql`
  3. 跑数据迁移脚本 `scripts/migrate-single-user.ts`（归属存量数据到管理员）
  4. `wrangler secret put RESEND_API_KEY`；在 Resend 验证发件域名
  5. 部署 Worker + 静态资源 `npm run deploy`（含 `web/dist`）
  6. 验证：旧 Bot 正常、cron 提醒仍推送 → 访问 `/chat` → 登录 → 对话 → 语音 → Dashboard

---

## 验收（Definition of Done）

- [ ] 所有 `requirements.md` 验收标准（AC-1 至 AC-13）满足
- [ ] `npm run type-check && npm test`（Worker）全绿；`npm --prefix web run build` + `svelte-check` 通过
- [ ] 受影响文档已更新：
  - `docs/schema.sql`
  - `docs/engineering/data-model.md`
  - `docs/engineering/security.md`
  - `docs/engineering/architecture.md`
  - `docs/engineering/adr/0010-frontend-svelte-spa-static-assets.md`（已建）
  - `CLAUDE.md`
  - `docs/specs/README.md`
- [ ] 无 secret 泄露，遵守[安全清单](../../engineering/security.md) §7
- [ ] 迁移脚本幂等，存量数据无损
