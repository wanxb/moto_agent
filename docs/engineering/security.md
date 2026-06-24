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

## 3. 访问控制（两道关卡）

实现见 `src/index.ts`：

1. **Webhook Secret**：比对请求头 `X-Telegram-Bot-Api-Secret-Token` 与 `TELEGRAM_WEBHOOK_SECRET`，不匹配返回 **401**。注册 webhook 时通过 `secret_token` 绑定（见 [`../../README.md`](../../README.md)）。
2. **chatId 白名单**：grammY 中间件校验 `ctx.chat.id == ALLOWED_CHAT_ID`，否则回"无访问权限"并终止。

> 顺序：先 secret（防伪造），后白名单（防越权）。两者都开才安全。

---

## 4. 密钥管理

| 密钥 | 用途 | 存储 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | Bot 身份 | Workers Secret |
| `TELEGRAM_WEBHOOK_SECRET` | 防伪造 | Workers Secret |
| `DEEPSEEK_API_KEY` | 主 LLM | Workers Secret |
| `ANTHROPIC_API_KEY` | 备 LLM | Workers Secret |
| `ALLOWED_CHAT_ID` | 白名单 | Workers Secret |

规则：
- 生产用 `wrangler secret put <NAME>`，**绝不进 `wrangler.toml` 或代码**。
- 本地用 `.dev.vars`（已 gitignore），从 `.dev.vars.example` 复制。
- 泄露应急：立即在对应平台 rotate（重置 Bot Token / API Key / webhook secret 并重注册）。
- `wrangler.toml` 里的 `database_id`/`kv id` 非密钥但**不要随意改动**（[`../../CLAUDE.md`](../../CLAUDE.md) §7）。

---

## 5. 第三方数据外发

- 用户消息文本会发送给 DeepSeek / Anthropic 以解析。MVP 数据为油耗/里程，无强隐私字段。
- 选型偏好可信 provider；不向不必要的第三方转发数据。
- Phase 3 多用户时应在隐私说明中告知用户数据会经 LLM 处理。

---

## 6. Phase 3 多用户安全（前瞻）

开放多用户前必须解决（建议先写 ADR）：

- **数据隔离**：所有查询带 `user_id`/`chat_id` 维度，杜绝越权读他人数据（在 `database.ts` 层强制）。
- **鉴权**：Telegram Login Widget 或 Workers 签发 JWT（Dashboard 场景）。
- **限流/配额**：按用户限速，防滥用拉高 LLM 成本。
- **隐私合规**：数据保留/删除策略、用户数据导出权。

> 在做多车（[`../specs/001-multi-vehicle/`](../specs/001-multi-vehicle/)）时就为表预留 `user_id` 演进位，避免 Phase 3 大改。

---

## 7. 安全检查清单（每次涉及鉴权/数据的改动）

- [ ] 新查询用参数化绑定，无 SQL 拼接。
- [ ] 不在日志里打印完整 secret/token/用户敏感数据。
- [ ] 新接口/命令经过白名单中间件。
- [ ] 新密钥走 Secret，更新 `.dev.vars.example`（占位）与本文件 §4。
- [ ] 多用户相关改动复核数据隔离。
