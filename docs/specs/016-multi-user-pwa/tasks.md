# 任务：多用户 PWA — 邮箱认证 + 对话式 Web 界面

> 规格 016 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)

---

## 任务清单

> 顺序：数据模型→数据访问→认证→中间件→对话界面→语音→绑定→仪表盘适配→测试→部署。
> 每条勾选前确认其验证项通过。

### T1 数据模型 — users 表

- [ ] **T1.1** 创建迁移 `migrations/0008_multi_user.sql`（幂等 CREATE TABLE IF NOT EXISTS）
- [ ] **T1.2** 同步 `docs/schema.sql` 加入 `users` 表
- [ ] **T1.3** 同步 `test/utils.ts` 建表语句
- [ ] **T1.4** 同步 `src/types.ts` 增加 `User` 接口
- [ ] **T1.5** 写存量数据迁移脚本（见 design.md §10）
  - 验证：`npm run db:init` 成功；空库 + 有数据库迁移后 users 表正确

### T2 数据访问层 — database.ts

- [ ] **T2.1** 新增 `getUserByEmail(email)` / `getUserByTelegramId(tgId)` / `createUser(email?, telegramId?)` / `updateUserLastLogin(id)`
- [ ] **T2.2** 新增 `bindTelegramToUser(email, telegramId, code)` 验证绑定
- [ ] **T2.3** 新增 `getVehicles(userId)`（替代无参数版本）
- [ ] **T2.4** 改造 `insertFuelRecord` 等写入函数，增加 `user_id` 参数
- [ ] **T2.5** 改造核心读取函数加 `user_id` 过滤（getLastFuelRecord、getFuelRecordsByDateRange 等）
  - 验证：`database.test.ts` 新增覆盖

### T3 认证系统 — Magic Link + Session

- [ ] **T3.1** 创建 `src/routes/auth-handler.ts`：
  - `POST /auth/send-link`：生成 token → KV 存 15min → 调 MailChannels API 发邮件
  - `GET /auth/verify`：校验 token → 创建/登录用户 → 生成 session → Set-Cookie → 302
  - `POST /auth/logout`：清除 KV 中的 session
  - `POST /auth/bind`：验证绑定码 → 关联 telegram_id 和 email
- [ ] **T3.2** 实现 MailChannels 邮件发送函数 `src/services/mail.ts`
- [ ] **T3.3** 实现 session 生成/校验/续期逻辑
- [ ] **T3.4** 配置域名 SPF/DKIM/DMARC 发件策略（一次性操作）
  - 验证：手动发邮件测试，检查收件箱（非垃圾箱）
  - 验证：过期 token 返回 401；有效 token 正常通过

### T4 PWA 中间件

- [ ] **T4.1** 在 `src/index.ts` 新增 `pwaAuth()` 中间件，拦截 `/chat*`、`/settings*`、`/dashboard*` 路径
- [ ] **T4.2** 公开路径白名单（`/auth/*`、`/manifest.json`、`/ping`）
- [ ] **T4.3** 实现 session cookie 解析（从 `Cookie` header 提取 `session_token`）
- [ ] **T4.4** 实现旧 token 兼容：`url.searchParams.get('token')` 仍可用
  - 验证：不带 cookie 访问 `/chat` → 302 到 `/auth/login`
  - 验证：带有效 cookie → 正常渲染页面
  - 验证：旧 Dashboard token 参数仍可用

### T5 对话界面 `/chat`

- [ ] **T5.1** 创建 `src/routes/chat-html.ts`：对话 HTML 页面（气泡样式 + 快捷面板 + 输入栏）
  - 移动端优先，深色主题（匹配现有 Dashboard 风格）
  - 消息气泡：用户右对齐（蓝色调），Bot 左对齐（灰色调），带时间戳
  - 底部固定输入栏 + 发送按钮 + 语音按钮
  - 快捷操作卡片：📊 仪表盘、⛽ 记加油、🚗 车辆管理、📋 历史
  - 页面加载时从 `/chat/api?history=1` 获取最近对话历史
  - 发送消息后滚到底部
  - URL 支持 `?lang=en` 双语
- [ ] **T5.2** 创建 `src/routes/chat-api.ts`：
  - `POST /chat/api`：接收 `{ text }` → session 解析 → 读 PWA 对话历史 KV → 调 Agent Loop → 写回 KV → 返回 `{ reply }`
  - `POST /chat/voice`：接收 multipart/form-data 录音 → 调 Whisper → 同文字链路
  - `GET /chat/api?history=1`：返回最近对话历史
- [ ] **T5.3** PWA 对话历史独立于 Telegram 会话（KV key: `session:pwa:{user_id}`）
  - 验证：发送消息 → 返回回复并存入历史 → 刷新页面后历史加载正确
  - 验证：对话历史不干扰 Telegram 端的会话

### T6 语音输入

- [ ] **T6.1** 前端录音实现（`chat-html.ts` 内）：
  - `navigator.mediaDevices.getUserMedia` → MediaRecorder
  - 录音按钮 UI（按住录音 / 松开发送）
  - 录音结束后上传 `FormData` 到 `/chat/voice`
- [ ] **T6.2** 后端 `/chat/voice` 处理：
  - 接收音频 blob → 调 `stt.ts` transcribe() → 走 Agent Loop
  - 返回 `{ text: "识别结果", reply: "Bot回复" }`
  - 验证：模拟录音上传 → 得到文字回复
  - 验证：浏览器权限拒绝 → 按钮置灰提示

### T7 Telegram 绑定 `/bind`

- [ ] **T7.1** 在 `bot.on('message:text')` 之前新增 `/bind` 命令 handler：
  - 参数校验（邮箱格式）
  - 生成 6 位验证码 → 存 `bind_code:{email}` KV（10 分钟 TTL）
  - 通过 MailChannels 发验证码邮件
  - 回复用户"验证码已发送到邮箱"
- [ ] **T7.2** 实现验证码校验（在 `POST /auth/bind` 中）：
  - 用户收到验证码后在 PWA 验证页输入
  - 或 Bot 中回复验证码自动绑定（简化版）
  - 校验通过 → UPDATE users SET telegram_id = ? WHERE email = ?
  - 验证：/bind → 收邮件 → PWA 输入验证码 → 绑定成功 → TG 和 PWA 数据一致

### T8 登录页 + 设置页

- [ ] **T8.1** 创建 `src/routes/auth-html.ts`：
  - 登录页：品牌 Logo + 邮箱输入框 + "发送登录链接"按钮 + 使用说明
  - 发送成功提示页："邮件已发送，请检查收件箱"
  - 链接过期/错误页面
  - 绑定验证码输入页（从邮箱收到的 6 位码）
- [ ] **T8.2** 创建 `src/routes/settings-html.ts`：
  - 当前用户信息（邮箱、绑定状态）
  - 语言切换（中/英）
  - Telegram 绑定状态 + 解绑按钮
  - 登出按钮
  - 验证：设置页正确显示用户信息；语言切换立即生效

### T9 PWA manifest + 安装支持

- [ ] **T9.1** 在 Worker 新增 `/manifest.json` 路由（返回 PWA manifest JSON）
- [ ] **T9.2** 所有 HTML 页面 `<head>` 加入 `<link rel="manifest" href="/manifest.json">` 和 `<meta name="theme-color">`
- [ ] **T9.3** 生成/引用一个简单的 SVG 图标（🏍 emoji 转 PNG）
  - 验证：手机 Chrome 打开 → "添加到主屏幕" 弹出 → 安装后全屏打开

### T10 仪表盘适配

- [ ] **T10.1** 修改 `src/routes/api.ts`：所有 `/api/v1/*` 端点支持 session cookie 鉴权
  - 新增从 Cookie 解析 user_id 的逻辑
  - 旧 token 参数兼容（30 天过渡期）
  - 所有查询增加 user_id 过滤
- [ ] **T10.2** 修改 `dashboard-html.ts`：
  - 页面加载时自动从 cookie 获取 session
  - 无 session 时显示登录提示
  - API 调用时自动带上 session（fetch 默认带 cookie）
  - 验证：PWA 登录后访问 /dashboard → 正常显示该用户数据

### T11 存量数据迁移脚本

- [ ] **T11.1** 创建 `migrations/0008_multi_user.sql`（users 表）
- [ ] **T11.2** 创建 `scripts/migrate-single-user.ts`：
  - 读 ALLOWED_CHAT_ID → 在 users 表创建管理员记录
  - 将所有 `user_id IS NULL` 的记录更新为管理员 user_id
  - 将 reminders 的 chat_id（旧 TG chat_id）迁移为 user_id
  - 幂等（可重跑）
- [ ] **T11.3** 测试迁移脚本：空库 → 正常；有数据 → 数据正确归属
  - 验证：迁移后所有车辆、记录、提醒都有正确的 user_id

### T12 测试覆盖

- [ ] **T12.1** 认证流程测试（mock MailChannels）：
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
- [ ] **T13.4** 更新 `docs/engineering/architecture.md`（新增 auth/PWA 组件）
- [ ] **T13.5** 更新 `CLAUDE.md` 代码地图 + 常用命令
- [ ] **T13.6** 更新 `docs/specs/README.md` 索引（标记本 spec 状态）
- [ ] **T13.7** 新增 `SENDER_EMAIL` 到 `.dev.vars.example` 和 `wrangler.toml` 说明
- [ ] **T13.8** 部署：

  1. `npm run type-check && npm test` 全绿
  2. 创建迁移 `wrangler d1 execute DB --remote --file=migrations/0008_multi_user.sql`
  3. 部署 Worker `npm run deploy`
  4. 验证：旧 Bot 正常 → 访问 `/chat` → 登录 → 对话 → 语音 → Dashboard

---

## 验收（Definition of Done）

- [ ] 所有 `requirements.md` 验收标准（AC-1 至 AC-10）满足
- [ ] `npm run type-check && npm test` 全绿
- [ ] 受影响文档已更新：
  - `docs/schema.sql`
  - `docs/engineering/data-model.md`
  - `docs/engineering/security.md`
  - `docs/engineering/architecture.md`
  - `CLAUDE.md`
  - `docs/specs/README.md`
- [ ] 无 secret 泄露，遵守[安全清单](../../engineering/security.md) §7
- [ ] 迁移脚本幂等，存量数据无损
