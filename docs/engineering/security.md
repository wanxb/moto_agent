# 安全：威胁模型 · 访问控制 · 密钥管理

> MVP 单用户场景的务实安全基线，并为 Phase 3 多用户预留方向。

---

## 1. 信任边界

```
[公网/Telegram] ──webhook──► [Cloudflare Worker] ──► [D1 / KV]   ← 受信内部
       不可信                    校验边界                持久层
                                     │
                                     └──► [DeepSeek / Anthropic]  ← 第三方，发送用户文本
```

任何进入 Worker 的请求都**不可信**，必须过两道校验（§3）。

---

## 2. 威胁模型（STRIDE 裁剪）

| 威胁 | 场景 | 缓解 | 状态 |
|------|------|------|------|
| **伪造请求**（Spoofing） | 攻击者伪造 Telegram webhook 调用 `/telegram` | `X-Telegram-Bot-Api-Secret-Token` 校验 | ✅ `index.ts` |
| **越权访问**（Elevation） | 他人 chatId 访问数据 | `ALLOWED_CHAT_ID` 白名单中间件 | ✅ `index.ts` |
| **信息泄露**（Disclosure） | secret/token 泄露 | Workers Secrets，不入 git，`.dev.vars` gitignore | ✅ |
| **注入**（Tampering） | SQL 注入 | 全参数化绑定（`.bind()`），无字符串拼接 | ✅ `database.ts` |
| **抵赖/审计**（Repudiation） | 无操作日志 | `console.log` 前缀化 → Logpush | 🟡 基础 |
| **拒绝服务**（DoS） | 刷请求耗成本 | 白名单先拦 + Workers 平台防护 + DeepSeek 控制台限额 | 🟡 部分 |
| **第三方数据外发** | 用户文本发给 LLM | 仅发必要内容；选可信 provider | 🟡 见 §5 |

---

## 3. 访问控制（多用户，spec 016）

> **重大变更（spec 016）**：原"chatId 白名单"门控**已移除**，改为**开放自助多用户**。访问控制现在分渠道：

**Telegram 渠道**（`src/index.ts`）：
1. **Webhook Secret**：比对请求头 `X-Telegram-Bot-Api-Secret-Token` 与 `TELEGRAM_WEBHOOK_SECRET`，不匹配返回 **401**（防伪造请求）。
2. **无白名单**：任何 TG 用户首次发消息即由 `pipeline.resolveUserId → getOrCreateTelegramUser` 自动建号，数据按 `user_id` 隔离。`ALLOWED_CHAT_ID` 降级为"管理员标识 + 存量迁移用"，不再拦人。成本由**每用户限流**兜底（无总量配额——见风险）。

**PWA / REST API 渠道**（`src/routes/auth-handler.ts` + `api.ts` + `chat-api.ts`）：
1. **Magic Link 邮箱认证**：无密码，邮件验证链接 → session cookie（`HttpOnly; Secure; SameSite=Lax`，30 天滑动续期）。
2. **数据隔离**：`/api/v1/*`、`/chat/*` 经 `resolveSession`→`user_id`，所有查询按 `user_id` 过滤（`database.ts` 层强制）。旧 Dashboard `?token=`（=`ALLOWED_CHAT_ID`）兼容 30 天过渡，仅管理员数据。
3. **账号绑定**：仅在 Telegram 内发起（`/bind <email>` → 邮件链接 → 合并），PWA 零 Telegram 文案。

> Telegram 先 secret（防伪造）；PWA 先 session（防越权）。数据隔离是默认拒绝：查询缺 `user_id` 即可能漏读，靠测试强制覆盖。

---

## 4. 密钥管理

| 密钥 | 用途 | 存储 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | Bot 身份 | Workers Secret |
| `TELEGRAM_WEBHOOK_SECRET` | 防伪造 | Workers Secret |
| `DEEPSEEK_API_KEY` | 主 LLM | Workers Secret |
| `ANTHROPIC_API_KEY` | 备 LLM | Workers Secret |
| `ALLOWED_CHAT_ID` | 管理员标识 + 存量迁移（已非门控） | Workers Secret |
| `RESEND_API_KEY` | 邮箱认证发信（spec 016） | Workers Secret |
| `SENDER_EMAIL` | 发件地址（Resend 已验证域名） | 环境变量（非密钥，可入 `wrangler.toml`/`.dev.vars`） |

规则：
- 生产用 `wrangler secret put <NAME>`，**绝不进 `wrangler.toml` 或代码**。
- 本地用 `.dev.vars`（已 gitignore），从 `.dev.vars.example` 复制。
- 泄露应急：立即在对应平台 rotate（重置 Bot Token / API Key / webhook secret 并重注册）。
- `wrangler.toml` 里的 `database_id`/`kv id` 非密钥但**不要随意改动**（[`../../CLAUDE.md`](../../CLAUDE.md) §7）。

---

## 5. 第三方数据外发

- 用户消息文本会发送给 DeepSeek / Anthropic 以解析。MVP 数据为油耗/里程，无强隐私字段。
- **语音音频**（spec 008）由 **Cloudflare Workers AI（Whisper）** 转写，**音频不出 Cloudflare**（[ADR-0007](adr/0007-cloudflare-workers-ai-stt.md)），隐私优于外发 OpenAI/Groq。
- 选型偏好可信 provider；不向不必要的第三方转发数据。
- Phase 3 多用户时应在隐私说明中告知用户数据会经 LLM 处理。

---

## 6. 多用户安全（spec 016 已落地）

实现见 [`../specs/016-multi-user-pwa/`](../specs/016-multi-user-pwa/)（requirements/design/tasks）。要点：

- **数据隔离 ✅**：所有读写带 `user_id`（直接列，非 JOIN，兼顾 `vehicle_id IS NULL` 的孤儿记录）；`database.ts` 层强制，测试覆盖隔离 + 孤儿场景。
- **鉴权 ✅**：PWA Magic Link（邮箱无密码）→ session cookie；Telegram 开放自助自动建号；账号合并经邮件验证链接。
- **限流 ✅ / 配额 ⚠️**：发信端点 `email+IP`、对话每用户限流均已有；**但开放自助后无总量/人均配额**，LLM 成本对公众敞口（见下风险）。
- **账号合并**：合并是并集不去重——两端同名车会重复，合并后提示用户处理（不自动猜，design §3.2）。
- **隐私合规 ⏳**：数据保留/删除/导出权尚未做（Phase 4）。

**未决风险（需跟进）**：
- ⚠️ **LLM 成本敞口**：开放自助下任何陌生人可触发 LLM 调用。当前仅每用户限流兜底。后续需：全局日配额、新用户冷却、可疑用量告警，必要时回退准入名单。
- ⏳ **解绑**：无自助解绑端点。
- ⏳ **auth 邮件链接确认页**：服务端 HTML 仍硬编码中文（点链接时无语言上下文）。

---

## 7. 安全检查清单（每次涉及鉴权/数据的改动）

- [ ] 新查询用参数化绑定，无 SQL 拼接。
- [ ] 不在日志里打印完整 secret/token/用户敏感数据。
- [ ] 新的读写路径带 `user_id` 过滤/落库（多用户隔离，缺失即越权）；带测试。
- [ ] 新密钥走 Secret，更新 `.dev.vars.example`（占位）与本文件 §4。
- [ ] PWA/API 新端点经 `resolveSession` 鉴权（401，不重定向）。
