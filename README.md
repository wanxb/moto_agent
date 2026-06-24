# 摩托车油耗管理 Bot

Telegram Bot，用自然语言记录加油数据，自动计算油耗统计。部署在 Cloudflare Workers + D1。

## 功能

- 发送加油信息 → 自动记录并显示本次油耗
- 查询最近 N 次 / 按日期范围统计油耗
- 多车管理：添加车辆、设默认车、按车记录与统计（"小绿加了 10 升…"）
- 维修保养记录：记录换机油/轮胎/保险等，查询保养历史
- 定时提醒：里程/日期阈值到期时主动推送（Cloudflare Cron Triggers）
- `/last` 查看最近一次加油记录
- `/stats` 查看本月统计

> 完整文档见 [`docs/`](docs/)（产品/工程/规格/流程）；AI 编码助手入口 [`CLAUDE.md`](CLAUDE.md)。

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Cloudflare Workers (TypeScript) |
| 数据库 | Cloudflare D1 (SQLite) |
| 会话 | Cloudflare KV |
| Bot 框架 | grammY |
| 主 LLM | DeepSeek V3 |
| 备用 LLM | Anthropic Claude Sonnet |

## 本地开发

```bash
# 安装依赖
npm install

# 复制环境变量模板
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 填入各项 key

# 初始化本地数据库
npm run db:init

# 启动本地开发服务器
npm run dev
```

## 测试

```bash
npm test
```

共 100 个测试，覆盖 LLM 调用、工具逻辑、多车管理、维保记录、定时提醒、会话持久化、Webhook 鉴权。

## 部署

```bash
# 设置生产 secrets（逐条执行，按提示输入值）
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY   # 可选，作为备用
npx wrangler secret put ALLOWED_CHAT_ID     # 可选，限制访问者

# 初始化远端数据库
npm run db:init:remote

# 部署
npm run deploy

# 注册 Telegram Webhook（替换 {TOKEN} 和 {SECRET}）
curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://moto-agent.<account>.workers.dev/telegram","secret_token":"{SECRET}"}'
```

## 数据模型

```sql
vehicles            -- 车辆：名称、是否默认（多车管理）
fuel_records        -- 加油记录：日期、里程、升数、总价、油品、所属车
mileage_records     -- 纯里程记录（未加油的骑行）
maintenance_records -- 维修保养：类型、里程、费用、所属车
reminders           -- 定时提醒：里程/日期阈值、状态
```

已有库按序执行迁移升级：

```bash
wrangler d1 execute moto-agent-db --remote --file=migrations/0001_multi_vehicle.sql
wrangler d1 execute moto-agent-db --remote --file=migrations/0002_maintenance.sql
wrangler d1 execute moto-agent-db --remote --file=migrations/0003_reminders.sql
```

油耗计算采用 fill-to-fill 法：`上次加油量 / 本次区间里程 × 100`。
