# 设计：多用户 PWA — 邮箱认证 + 对话式 Web 界面

> 规格 016 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[architecture](../../engineering/architecture.md) · [data-model](../../engineering/data-model.md) · [agent-design](../../engineering/agent-design.md) · [security](../../engineering/security.md)

---

## 1. 方案概述

在 Cloudflare Worker 中扩展以下能力：

1. **用户认证系统**：邮箱 Magic Link（MailChannels 免费发信）+ KV session token，**零第三方费用**
2. **用户数据模型**：新建 `users` 表，存量数据迁移至管理员用户，新数据按 `user_id` 隔离
3. **PWA 前端**：Worker 内嵌 HTML 对话界面（复用现有仪表盘模式），含气泡聊天 + 快捷操作面板 + 语音输入
4. **Telegram 绑定**：新增 `/bind` 命令，通过邮箱验证码关联 TG 账号

整体架构：

```
┌──────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                      │
│                                                           │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐   │
│  │ Telegram  │  │  PWA/Web  │  │  Auth Routes          │   │
│  │ Bot       │  │  Pages    │  │  /auth/*              │   │
│  └─────┬─────┘  └─────┬────┘  └───────────┬───────────┘   │
│        │              │                  │                │
│        ▼              ▼                  ▼                │
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

## 2. 数据模型变更

> 遵守"只增不删"（[data-model](../../engineering/data-model.md) §5）。

### 新建 users 表

```sql
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    UNIQUE,                  -- 邮箱（pwa 用户必填，tg-only 用户暂空）
    telegram_id TEXT    UNIQUE,                  -- Telegram chat_id（tg 用户必填）
    nickname    TEXT,                            -- 昵称（可选）
    lang        TEXT    NOT NULL DEFAULT 'zh',   -- 语言偏好 'zh' | 'en'
    is_admin    INTEGER NOT NULL DEFAULT 0,      -- 1=管理员（存量数据迁移目标）
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    last_login  TEXT                             -- 最近登录时间
);
```

### env var 变更

| 变量 | 变更 | 说明 |
|------|------|------|
| `ALLOWED_CHAT_ID` | 保留，但语义变为"管理员 chat_id" | 用于迁移存量数据 + 管理员入口 |
| `DASHBOARD_URL` | 保留 | PWA 和 Bot 同域名 |
| 新增 `SENDER_EMAIL` | 新增环境变量 | 发件邮箱地址（如 `noreply@domain.com`） |

### 同步点

- `docs/schema.sql` 加入 `users` 表
- `test/utils.ts` 建表语句同步

---

## 3. 认证流程

### 3.1 邮箱 Magic Link

```
User                     PWA                      Worker                 MailChannels            KV
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
 │                        │                         │ POST /tx/v1/send      │                   │
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
 │                         │── MailChannels ───►│                     │                │
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

### 3.3 Session 管理

| 存储 | Key | Value | TTL |
|------|-----|-------|-----|
| Magic Link | `magic_link:{uuid}` | `{email, expires_at}` | 15 min |
| Session | `session:{token}` | `{user_id, email, created_at}` | 30 days |
| PWA 对话历史 | `session:pwa:{user_id}` | `Message[]` | 1 h |
| 绑定验证码 | `bind_code:{email}` | `{code, telegram_id}` | 10 min |

Session 校验中间件：

```
request → 有 Cookie: session_token=xxx?
    ↓ 否 → 重定向到 /auth/login?redirect=原路径
    ↓ 是 → KV.get("session:xxx") → 有?
        ↓ 无 → cookie 过期，重定向到 /auth/login
        ↓ 有 → 解析 user_id → 注入后续请求

API 请求的鉴权：
  Cookie: session_token=xxx (PWA)
  或 x-user-id header (内部/REST)
  或 token=xxx query param (旧仪表盘兼容)
```

---

## 4. PWA 前端页面

### 4.1 页面结构

Worker 新增以下路由：

| 路径 | 方法 | 文件 | 说明 |
|------|------|------|------|
| `/auth/login` | GET | `src/routes/auth-html.ts` | 登录页（输入邮箱） |
| `/auth/verify` | GET | `src/routes/auth-handler.ts` | Magic link 回调（验证 → 302） |
| `/auth/bind` | POST | `src/routes/auth-handler.ts` | Telegram 绑定验证码 |
| `/auth/send-link` | POST | `src/routes/auth-handler.ts` | 发送魔法链接 |
| `/auth/logout` | POST | `src/routes/auth-handler.ts` | 登出（清除 session） |
| `/chat` | GET | `src/routes/chat-html.ts` | 对话界面（主页面） |
| `/chat/api` | POST | `src/routes/chat-api.ts` | 对话 API（已有 `/api/v1/chat` 扩展） |
| `/chat/voice` | POST | `src/routes/chat-api.ts` | 语音上传+转写+对话 |
| `/settings` | GET | `src/routes/settings-html.ts` | 设置页（语言/绑定/登出） |
| `/manifest.json` | GET | 内联在 Worker | PWA manifest |
| `/dashboard*` | 已有 | `src/routes/dashboard-html.ts` | 已有仪表盘，加 user_id 过滤 |

### 4.2 对话界面设计 (`/chat`)

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

浏览器侧：
```
navigator.mediaDevices.getUserMedia({audio: true})
  → MediaRecorder → chunks → Blob (webm/opus)
  → POST /chat/voice (multipart/form-data)
```

Worker 侧：
```
接收录音 → 格式转换（如需，目前 Whisper 支持 webm/opus）→ 调 stt.ts 的 transcribe()
  → 转文字 → 走现有 Agent Loop
  → 返回回复文本
```

### 4.4 PWA Manifest

```json
{
  "name": "Moto Bot — 摩托车油耗管家",
  "short_name": "Moto Bot",
  "description": "用对话或语音记录加油，自动计算油耗",
  "start_url": "/chat",
  "display": "standalone",
  "background_color": "#111827",
  "theme_color": "#f59e0b",
  "icons": [{ "src": "/icon.png", "sizes": "192x192", "type": "image/png" }]
}
```

### 4.5 已有仪表盘修改

- 原有 `/dashboard` 路径：增加用户校验中间件
- 现有 API `/api/v1/*` 端点：增加 `user_id` 过滤参数，从 session cookie 获取用户，而非 token 参数
- 兼容期：两种鉴权方式并存（旧 `token=` 参数 + 新 session cookie）

---

## 5. 数据隔离（database.ts 改动）

所有涉及多表 JOIN 或单表查询的函数，增加 `user_id` 过滤条件。

### 改造原则

- `user_id` 参数从 Session 中间件提取，通过请求上下文或显式参数传入。
- Telegram 入口：`user_id` 从 `chat_id` 查 `users.telegram_id` 得到
- PWA 入口：`user_id` 从 session cookie 解析得到

### 关键变更函数

| 函数 | 变更 |
|------|------|
| `insertFuelRecord` | 新增 `user_id` 参数 |
| `getLastFuelRecord(vehicleId, userId)` | 加 user_id 过滤 |
| `getRecentFuelRecords(limit, userId)` | 加 user_id 过滤（通过 vehicle） |
| `getFuelRecordsByDateRange(since, until, userId)` | 加 user_id 过滤（JOIN vehicles） |
| `queryStats(...)` | 已通过 `getFuelRecordsByDateRange` 链式传递 |
| `getVehicles(userId)` | 新增，替代原有全量查询 |
| `insertVehicle(...)` | 新增 `user_id` 参数 |

> 工具层（`src/tools/`）对应工具调用时传入当前用户 ID。

---

## 6. 中间件设计

### 6.1 PWA 认证中间件

```typescript
// 在 index.ts 的 fetch() 中新增 path-based 中间件
async function pwaAuth(request, env): Promise<{ user: User | null; response: Response | null }> {
  const url = new URL(request.url);

  // 公开路径不校验
  const publicPaths = ['/auth/login', '/auth/send-link', '/auth/verify',
                        '/manifest.json', '/ping'];
  if (publicPaths.some(p => url.pathname.startsWith(p))) {
    return { user: null, response: null };
  }

  // 从 Cookie 提取 session token
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session_token=([^;]+)/);
  const token = match?.[1] || url.searchParams.get('token');

  if (!token) {
    return { user: null, response: Response.redirect(`${url.origin}/auth/login?redirect=${encodeURIComponent(url.pathname)}`, 302) };
  }

  const raw = await env.SESSION_KV.get(`session:${token}`);
  if (!raw) {
    return { user: null, response: Response.redirect(`${url.origin}/auth/login?redirect=${encodeURIComponent(url.pathname)}`, 302) };
  }

  const session = JSON.parse(raw);
  return { user: session, response: null };
}
```

### 6.2 API 鉴权

```typescript
// 在 handleApiRequest 中扩展鉴权逻辑
// 1. 先检查旧 token 参数（兼容旧 Dashboard）
// 2. 再检查 Cookie session_token
// 3. 最后检查 Authorization header (X-User-Id)
// 解析得到 user_id 后传给查询函数
```

---

## 7. MailChannels 集成

API 调用方式（无需 API key，从 Cloudflare Workers 网络发出）：

```typescript
async function sendMagicLinkEmail(email: string, link: string, env: Env): Promise<void> {
  const domain = new URL(env.DASHBOARD_URL || 'https://moto-bot.example.com').hostname;

  const resp = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: { email: `noreply@${domain}`, name: 'Moto Bot' },
      subject: '🔑 Moto Bot 登录链接',
      content: [{
        type: 'text/plain',
        value: `点击以下链接登录 Moto Bot（15分钟内有效）：\n\n${link}\n\n如果非本人操作，请忽略此邮件。`
      }]
    })
  });

  if (!resp.ok) {
    console.error('[mail] send failed:', await resp.text());
    throw new Error('邮件发送失败');
  }
}
```

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
| MailChannels 发信失败 | 返回"邮件发送失败，请稍后重试"，日志记录详情 |
| Magic Link 已被使用 | 显示"此链接已使用过，请重新申请" |
| Magic Link 过期 | 显示"链接已过期，请重新申请"，返回登录页 |
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

部署时需要一次性迁移存量单用户数据：

```sql
-- Step 1: 创建管理员用户（ALLOWED_CHAT_ID 对应的用户）
INSERT INTO users (telegram_id, email, nickname, lang, is_admin)
VALUES (?, 'admin@local', 'Admin', 'zh', 1)
ON CONFLICT(telegram_id) DO NOTHING;

-- Step 2: 将存量数据归到管理员用户
UPDATE vehicles SET user_id = (SELECT id FROM users WHERE telegram_id = ? LIMIT 1)
WHERE user_id IS NULL;

-- Step 3: 将已有 reminders 的 chat_id 关联到管理员
UPDATE reminders SET chat_id = (SELECT id FROM users WHERE telegram_id = reminders.chat_id LIMIT 1)
WHERE chat_id IS NOT NULL;
```

> 注意：`reminders.chat_id` 字段原意是 TG chat_id，迁移后改为 user_id 引用。

---

## 11. 兼容性策略

| 方面 | 策略 |
|------|------|
| 旧 Telegram 用户 | 数据自动归属管理员账户，零感知 |
| 旧 Dashboard token | token 参数继续有效（管理员访问），PWA 用户使用 session cookie |
| `/api/v1/*` 端点 | 适配 session 鉴权，旧 token 兼容 30 天过渡期 |
| 旧 `ALLOWED_CHAT_ID` | 保留为管理员标识，Bot 白名单仍用它 |
| 新用户从 Telegram 首次使用 | 自动创建 `users` 记录（`telegram_id` 主键，email 暂空） |
| 新用户从 PWA 首次使用 | 创建 `users` 记录（email 主键，telegram_id 暂空） |

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
| MailChannels 邮件被标记为垃圾邮件 | 配置 SPF/DKIM/DMARC；文案明确指出发件源；备选：Resend 免费层 |
| Session token 安全性（存储在 localStorage） | Token 不包含用户信息，过期即废；后续可迁移到 httpOnly cookie 由 Worker set-cookie |
| KV 最终一致性可能导致短时 session 不一致 | Session token 在 KV 写入后秒级可见，可接受；Magic Link 要求 token 存在才有效 |
| 多用户后 LLM 成本上升 | 保持每用户限流（已有）；后续可加用量配额 |
| 修改 database.ts 带 user_id 影响范围大 | 渐进式改造，先改核心查询路径，非紧急路径按需改 |

---

## 15. 测试要点

> 对应 [testing-strategy](../../engineering/testing-strategy.md)。

| 维度 | 测试 |
|------|------|
| 认证流程 | Magic link 生成/验证/过期；session 创建/过期/续期 |
| 数据隔离 | 用户 A 创建记录后用户 B 查询不到；多用户同时使用不交叉 |
| PWA 对话 | POST /chat/api 带 session → 返回回复；不带 session → 401 |
| Telegram 绑定 | /bind 命令→ 验证码 → POST /auth/bind → 关联成功 |
| 语音 | 模拟录音上传 → Whisper mock → 回复 |
| 存量迁移 | 空库迁移、有数据迁移、重复迁移幂等 |
| 兼容性 | 旧 Dashboard token 仍能访问自己数据 |
| 限流 | 认证端点 5 次/5min 限制 |
