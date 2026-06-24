# 可观测性与运维

> 日志、监控、部署、故障处置。MVP 单用户务实方案，零额外成本。

---

## 1. 日志

- **方式**：`console.log` / `console.error`，**前缀化模块标签**便于检索：
  | 前缀 | 来源 |
  |------|------|
  | `[worker]` | `index.ts` 顶层错误 |
  | `[agent]` | `session.ts` Loop 异常 |
  | `[tool]` | 工具执行结果/错误 |
  | `[llm]` | fallback 切换等 |
  | `[metric]` | 指标埋点（建议，见 [metrics](../product/metrics.md)） |
- **去向**：Cloudflare Workers Dashboard 实时日志（`wrangler tail`）+ Logpush（可配）。
- **纪律**：不打印完整 secret/token；不打印超长 LLM 原文（截断，参考 `agent.ts` 的 `.slice(0,80)`）。

```bash
npx wrangler tail        # 实时跟踪线上日志
```

---

## 2. 监控与告警

| 关注 | 手段 | 阈值/动作 |
|------|------|----------|
| 错误率 | Workers Dashboard / `wrangler tail` 看 `[worker]`/`[agent]` 错误 | 突增即排查 |
| 响应延迟 | `[metric]` 埋点计时 | P95 > 5s 关注，> 8s 红线 |
| LLM fallback 频率 | 日志 `[llm] ... falling back` 计数 | 频繁 fallback = DeepSeek 异常，查 provider |
| 成本 | DeepSeek 控制台用量 + 设限额 | > $5/月 红线（[护栏](../product/metrics.md)） |

> MVP 不引入 APM/外部监控平台（保持零成本）。规模化（Phase 3）再评估。

---

## 3. 部署运维手册（Runbook）

### 3.1 首次部署

```bash
# 1. 创建并初始化 D1
wrangler d1 create moto-agent-db          # 把返回的 database_id 填入 wrangler.toml
npm run db:init:remote                     # 建表（schema.sql）

# 2. 创建 KV namespace
wrangler kv:namespace create SESSION_KV    # 把返回的 id 填入 wrangler.toml

# 3. 配置 secrets（逐条，按提示输入）
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY     # 可选（备用）
npx wrangler secret put ALLOWED_CHAT_ID       # 可选（限制访问）

# 4. 部署
npm run deploy

# 5. 注册 Telegram Webhook（一次性，替换 {TOKEN}/{SECRET}/{account}）
curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://moto-agent.{account}.workers.dev/telegram","secret_token":"{SECRET}"}'
```

### 3.2 日常发布

```bash
npm run type-check && npm test    # 门禁，必须全绿
npm run deploy                     # 部署（Workers 原子切换，秒级）
```

### 3.3 数据库迁移

见 [`data-model.md`](data-model.md) §5。要点：只增不删、`schema.sql` 与 `test/utils.ts` 同步、先本地后 `--remote`。

### 3.4 部署后冒烟

1. Telegram 发 `/start` → 收到欢迎语。
2. 发一条加油记录 → 正确解析 + 回油耗。
3. 发查询 → 正确统计。
4. `wrangler tail` 确认无 error。

---

## 4. 故障处置（Playbook）

| 症状 | 可能原因 | 处置 |
|------|---------|------|
| Bot 不回复 | webhook 未注册/secret 不符 | `getWebhookInfo` 查状态；重注册（§3.1 步骤 5） |
| 全部回"出错了" | LLM 双失败 / D1 异常 | `wrangler tail` 看 `[agent]`/`[llm]`/`[tool]`；查 provider 状态 |
| 频繁 fallback 到 Claude | DeepSeek 限流/故障 | 查 DeepSeek 状态页与配额；必要时临时把 Claude 设主 |
| 回复变慢 | LLM 延迟 / 多轮工具 | 看 `[metric]` 延迟；确认未误触多轮 |
| "无访问权限" | chatId 不在白名单 | 核对 `ALLOWED_CHAT_ID` |
| 部署失败 | 类型错误 / 配置错 | 本地 `type-check`；核对 `wrangler.toml` bindings |

### 回滚

Workers 支持版本回滚：

```bash
wrangler deployments list                  # 查历史版本
wrangler rollback [--message "原因"]        # 回滚到上一个稳定版本
```

> 数据层无破坏性迁移（只增不删），回滚代码通常无需回滚数据。

---

## 5. 成本监控

| 项 | 免费额度 | 预计 | 监控 |
|----|---------|------|------|
| Workers | 10万次/天 | ~50/天 | Dashboard |
| D1 | 5GB / 500万读/天 | 极少 | Dashboard |
| KV | 10万读 / 1000写 每天 | ~100/天 | Dashboard |
| DeepSeek | — | ~$0.1–0.3/月 | **控制台设限额** |
| Anthropic | — | 偶发 ~$0 | 控制台 |

总计 **< $1/月**。红线 $5/月。

---

## 6. Phase 2 运维新增（前瞻）

- **Cron Triggers**（提醒功能）：`wrangler.toml` 加 `[triggers] crons`，新增定时入口；监控其执行日志。
- 迁移目录化（`migrations/`），登记每次 schema 变更。
