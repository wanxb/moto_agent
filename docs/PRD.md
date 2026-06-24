# 摩托车油耗管理 Agent — MVP 产品文档

**版本：** v0.2  
**日期：** 2026-06-23  
**状态：** 草稿

---

## 1. 产品概述

### 1.1 背景

骑手在加油后需要手动记录油耗数据（里程、加油量、价格），目前依赖备忘录或表格，操作繁琐，数据分散，无法方便地统计和分析。

### 1.2 产品定位

基于 Telegram Bot + Claude AI 的摩托车油耗管理助手。用自然语言输入加油信息，系统自动解析、存储并计算油耗，随时查询历史数据与统计报告。

### 1.3 核心价值

- **零学习成本**：说人话即可操作，无需记忆指令格式
- **随时随地**：加油站拿出手机发一条消息，5 秒完成记录
- **数据资产**：长期积累，可分析骑行习惯、车辆状态趋势

---

## 2. 目标用户

**MVP 阶段**：单一用户（开发者本人），单辆摩托车。

| 属性 | 描述 |
|------|------|
| 使用场景 | 加油后记录、骑行后查询 |
| 输入方式 | Telegram 文字消息 |
| 查询需求 | 当次油耗、区间统计、费用汇总 |
| 技术背景 | 能自行部署，会用 Telegram |

---

## 3. MVP 功能范围

### 3.1 功能清单（In Scope）

#### 核心记录
- 记录加油信息：日期、加油量（升）、单价（元/升）或总价、当前里程
- 记录纯里程（未加油的骑行）
- 自动推断缺失字段（如只说总价和升数，自动算单价）

#### 查询与统计
- 查询最近一次加油记录
- 查询区间油耗（本周、本月、最近 N 次）
- 统计平均油耗（升/百公里）
- 统计总费用与平均费用

#### 体验
- 自然语言输入，无需固定格式
- 输入模糊时主动确认（"您是指加了 10 升还是花了 10 块？"）
- 每次记录后即时反馈计算结果

### 3.2 排除在外（Out of Scope for MVP）

| 功能 | 原因 | 计划阶段 |
|------|------|---------|
| 语音输入 | 增加 STT 复杂度 | Phase 2 |
| 多辆车管理 | 数据模型变复杂 | Phase 2 |
| 多用户支持 | 需要用户隔离和鉴权 | Phase 3 |
| 可视化图表 | 需要 Web 层 | Phase 3 |
| 维修保养记录 | 超出 MVP 范围 | Phase 2 |
| 数据导出（CSV/Excel）| 非核心 | Phase 2 |
| 提醒功能（换机油等）| 需要定时任务 | Phase 2 |

---

## 4. 核心交互设计

### 4.1 记录加油

```
用户：刚加了 10 升 95 号，花了 98 块，里程 12580
Bot：✅ 已记录
     📍 里程：12,580 km
     ⛽ 加油：10 L × 9.80 元/L = ¥98.00
     📊 本次油耗：3.13 L/100km（距上次 319 km）
```

```
用户：加油，38 升，总价 370，现在表显 8200
Bot：✅ 已记录
     📍 里程：8,200 km
     ⛽ 加油：38 L × 9.74 元/L = ¥370.00
     📊 本次油耗：（首次记录，无法计算区间油耗）
```

### 4.2 查询统计

```
用户：最近 3 个月油耗怎么样
Bot：📊 最近 3 个月油耗统计
     ─────────────────────
     4月  3.21 L/100km  ¥156
     5月  3.08 L/100km  ¥142
     6月  3.34 L/100km  ¥98（月中）
     ─────────────────────
     平均  3.21 L/100km
     总计  ¥396 / 1,247 km
```

```
用户：上次什么时候加的油
Bot：🕐 最近一次加油
     日期：2026-06-18
     里程：12,580 km，加油 10 L，¥98.00
     距今已行驶约 47 km
```

### 4.3 模糊输入处理

```
用户：加油 300 块
Bot：收到 ¥300 的加油记录，请补充：
     1. 加了多少升？
     2. 当前里程是多少？
```

### 4.4 命令（兜底）

| 命令 | 说明 |
|------|------|
| `/start` | 欢迎语 + 使用说明 |
| `/stats` | 快速查看本月统计 |
| `/last` | 最近一条记录 |
| `/help` | 帮助信息 |

---

## 5. 技术架构

### 5.1 技术选型

| 层级 | MVP 选型 | 选型理由 |
|------|---------|---------|
| Bot 框架 | `grammy`（TypeScript） | Cloudflare Workers 原生支持，webhook 模式，无需长连接 |
| AI 模型（主） | DeepSeek-V3（`api.deepseek.com`） | 中文能力强，工具调用稳定，成本极低（约 Claude 1/30 价格） |
| AI 模型（备） | Claude Sonnet（Anthropic API） | DeepSeek 不可用时自动切换，保障可用性 |
| Agent 框架 | 自实现 Agent Loop（参考 learn.shareai.run，TypeScript 移植） | 轻量可控，适配 Cloudflare Workers 无状态执行模型 |
| 存储 | Cloudflare D1（SQLite-compatible） | Workers 原生集成，零配置，免费层 5GB，无需管理 |
| 对话状态 | Cloudflare KV | 跨请求存储短期会话历史，读写延迟 < 20ms |
| 部署 | Cloudflare Workers | 免费层 10万次/天，边缘执行，无服务器管理，全球低延迟 |
| 语言 | TypeScript | Cloudflare Workers 原生语言，类型安全，部署工具链完善 |

> **⚠️ 语言变更说明**：从 Python 切换到 TypeScript，原因是 Cloudflare Workers 对 Python 支持仍处于实验阶段，限制多（无文件系统、网络限制、Pyodide 体积大）。TypeScript 是 Workers 的一等公民，生态工具（`wrangler`、D1、KV）全部原生支持。Agent Loop 的核心逻辑（while 循环 + 工具调度）语言无关，移植成本低。

### 5.2 架构总览

```
Telegram 服务器
    │  webhook POST /telegram
    ▼
┌─────────────────────────────────────────────────┐
│           Cloudflare Workers                     │
│                                                  │
│  ① webhook handler（grammy）                     │
│     • 验证 token，提取 chat_id + 消息文本          │
│     • 从 KV 读取该 chat_id 的对话历史              │
│                                                  │
│  ② Agent Loop                                    │
│     while true:                                  │
│       response = llm(messages, tools)  ──────────┼──→ DeepSeek V3（主）
│       if no_tool_use: break            ──────────┼──→ Claude Sonnet（备，自动 fallback）
│       results = dispatch(tool_calls)             │
│       messages.push(results)                     │
│                                                  │
│  ③ Tool Layer                                    │
│     • log_fuel()        ─────────────────────────┼──→ D1 写入
│     • log_mileage()     ─────────────────────────┼──→ D1 写入
│     • query_stats()     ─────────────────────────┼──→ D1 读取
│     • get_last_record() ─────────────────────────┼──→ D1 读取
│                                                  │
│  ④ 对话历史写回 KV                                │
│  ⑤ 通过 Telegram Bot API 发送回复                 │
└─────────────────────────────────────────────────┘
           │                    │
    Cloudflare D1          Cloudflare KV
  (fuel_records 等表)    (chat_id → 对话历史)
```

### 5.3 Agent Loop 设计（MVP）

MVP 采用教程 S01-S05 的精简模式（TypeScript 移植）：

- **S01** Agent Loop 核心：`while true` + `stop_reason` 判断
- **S02** 工具调度表：`TOOL_HANDLERS` 对象分发
- **S03** 权限控制：仅允许预定义的 4 个工具，无 shell 执行
- **S04** Hooks（轻量）：PostToolUse 写日志到 Workers `console.log`

不引入的复杂机制（MVP 阶段）：S06 子智能体、S08 上下文压缩、S09 持久记忆、S13 后台任务、S15 多智能体。

**模型 Fallback 逻辑：**

```typescript
async function callLLM(messages, tools) {
  try {
    return await deepseek.chat(messages, tools);   // 主模型
  } catch (e) {
    if (isRetryable(e)) {
      return await anthropic.chat(messages, tools); // 备用模型
    }
    throw e;
  }
}
// 触发 fallback 的条件：5xx 错误、超时、rate limit 持续超过 3 次重试
```

**Cloudflare Workers 执行限制适配：**

| 限制 | 数值 | 应对策略 |
|------|------|---------|
| 单次请求 CPU 时间 | 10ms（免费）/ 30s（付费） | AI API 等待时间不计入 CPU，仅计算逻辑运算，免费层够用 |
| 单次请求 wall time | 30s | Agent Loop 控制最多 3 轮工具调用，预计 < 10s |
| 内存 | 128MB | 对话历史存 KV，不在内存累积 |

### 5.4 对话上下文管理

每个 `chat_id` 的对话历史存入 **Cloudflare KV**（key: `session:{chat_id}`），保留最近 10 条消息，TTL 设为 1 小时。请求结束后写回 KV，下次请求时读取，实现跨 Workers 请求的状态持续。

---

## 6. 数据模型

### 6.1 MVP Schema（SQLite）

```sql
-- 加油记录
CREATE TABLE fuel_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,           -- ISO 8601: 2026-06-18
    odometer    REAL NOT NULL,           -- 里程（km）
    liters      REAL NOT NULL,           -- 加油量（升）
    price_total REAL NOT NULL,           -- 总价（元）
    price_per_l REAL GENERATED ALWAYS AS (price_total / liters) STORED,
    fuel_type   TEXT DEFAULT '95',       -- 油品: 92/95/98
    note        TEXT,                    -- 备注
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 里程记录（无加油的骑行，用于补全区间计算）
CREATE TABLE mileage_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,
    odometer    REAL NOT NULL,
    note        TEXT,
    created_at  TEXT DEFAULT (datetime('now', 'localtime'))
);
```

### 6.2 核心计算逻辑

```
区间油耗（L/100km）= 上次加油量（L）/ 区间里程（km）× 100
区间里程 = 本次里程 - 上次记录里程
```

说明：采用"两次加满法"计算逻辑（记录时不要求加满，但建议每次尽量加满以提高精度）。

### 6.3 演进方向

| 阶段 | 变更 |
|------|------|
| Phase 2（多车）| 新增 `vehicles` 表，`fuel_records` 加 `vehicle_id` 外键 |
| Phase 3（多用户）| 新增 `users` 表（存 `chat_id`），数据隔离 |
| Phase 3（迁移 PG）| Schema 不变，连接字符串切换，`aiosqlite` → `asyncpg` |
| Phase 4（维保）| 新增 `maintenance_records` 表 |

---

## 7. 部署方案

### 7.1 MVP 部署（Cloudflare Workers）

```
项目结构：
moto_agent/
├── src/
│   ├── index.ts          # Workers 入口 + webhook handler
│   ├── agent.ts          # Agent Loop 核心
│   ├── tools.ts          # 4 个工具实现
│   ├── database.ts       # D1 操作层
│   ├── llm.ts            # DeepSeek/Anthropic 双模型封装
│   └── types.ts          # 类型定义
├── docs/schema.sql       # D1 建表脚本
├── wrangler.toml         # Cloudflare 配置
├── package.json
└── .dev.vars.example     # 本地开发环境变量模板
```

**`wrangler.toml` 关键配置：**
```toml
name = "moto-agent"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "moto-agent-db"
database_id = "xxxx"

[[kv_namespaces]]
binding = "SESSION_KV"
id = "xxxx"
```

**环境变量（Workers Secrets）：**
```
TELEGRAM_BOT_TOKEN    # Bot Token
TELEGRAM_WEBHOOK_SECRET  # 防伪造请求
DEEPSEEK_API_KEY      # 主模型
ANTHROPIC_API_KEY     # 备用模型
ALLOWED_CHAT_ID       # 单用户白名单
```

**部署流程：**
```bash
# 1. 创建 D1 数据库并初始化 schema
wrangler d1 create moto-agent-db
wrangler d1 execute moto-agent-db --file=docs/schema.sql

# 2. 创建 KV namespace
wrangler kv:namespace create SESSION_KV

# 3. 部署 Worker
wrangler deploy

# 4. 注册 Telegram Webhook（一次性）
curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://moto-agent.{user}.workers.dev/telegram"
```

### 7.2 成本估算（MVP）

| 项目 | 免费层额度 | 预计用量 | 费用 |
|------|-----------|---------|------|
| Cloudflare Workers | 10万次/天 | ~50次/天 | 免费 |
| Cloudflare D1 | 5GB存储，500万次读/天 | 极少 | 免费 |
| Cloudflare KV | 10万次读/天，1000次写/天 | ~100次/天 | 免费 |
| DeepSeek V3 API | — | ~$0.1-0.3/月（每天 10 次） | $0.1-0.3 |
| Anthropic API（备用）| — | 偶发 fallback，可忽略 | ~$0 |
| Telegram Bot | 免费 | — | 免费 |
| **合计** | | | **< $1/月** |

> Railway 方案成本约 $6-8/月；Cloudflare Workers 方案在 MVP 阶段几乎零成本。

---

## 8. 扩展路线图

### Phase 1 — MVP（当前）

**目标**：跑通核心链路，个人使用验证价值

- [x] 技术选型确定（DeepSeek 主 + Claude 备，Cloudflare Workers）
- [ ] D1 schema 初始化 + wrangler 配置
- [ ] Agent Loop（TypeScript）+ 4 个工具实现
- [ ] DeepSeek/Anthropic 双模型封装 + fallback 逻辑
- [ ] Telegram webhook handler（grammy）
- [ ] Cloudflare Workers 部署 + webhook 注册
- [ ] 自然语言记录 + 基础查询端到端测试

**验收标准**：能在 Telegram 中用自然语言完成加油记录，并查询油耗统计，DeepSeek 不可用时自动切换到 Claude 继续服务。

---

### Phase 2 — 功能完善（1-2 个月后）

**目标**：提升便利性，扩展记录维度

- 语音输入（Whisper API 转文字，处理 OGG 格式）
- 多辆车支持（记录时指定/切换车辆）
- 维修保养记录（换机油、换轮胎、保险等）
- 定时提醒（换机油里程提醒、保险到期提醒）
- 数据导出（CSV，通过 Telegram 文件发送）

**技术变更**：
- 新增 Whisper API 调用（Workers 内 fetch OGG → Whisper endpoint）
- 定时提醒：Cloudflare **Cron Triggers**（Workers 原生支持，替代 S14 Cron 调度器）
- D1 新增 `vehicles`、`maintenance_records` 表

---

### Phase 3 — 多用户 + 可视化（3-6 个月后）

**目标**：开放给其他骑手使用，提供数据洞察

- 多用户支持（基于 `chat_id` 隔离，D1 加 `user_id` 字段）
- Web Dashboard（骑行数据可视化图表）
- 用户注册 / 车辆管理页面
- 数据图表（油耗趋势、费用分布、月度对比）

**技术变更**：
- D1 继续使用（多用户并发读写，D1 支持，无需迁移到 PostgreSQL）
- 新增 **Cloudflare Pages** 承载 Web Dashboard（与 Workers 同生态，零额外配置）
- 鉴权：Telegram Login Widget 或 Workers 签发 JWT
- 若数据量超过 D1 限制（5GB），迁移到 Hyperdrive + 外部 PostgreSQL

---

### Phase 4 — 智能化与生态（6 个月后）

**目标**：深度分析，连接更多数据源

- OBD 数据接入（实时油耗、故障码读取）
- 骑行轨迹记录（GPS 打点，热力图）
- AI 异常检测（油耗突增预警，可能的车辆故障提示）
- 社区功能（骑友油耗横向对比）
- 多平台支持（企业微信 Bot，若 API 开放则接入微信）

---

## 9. 技术演进方向

```
Phase 1 (MVP)                  Phase 2                  Phase 3                  Phase 4
─────────────────────────────────────────────────────────────────────────────────────────

Bot:    Telegram webhook    →  + Voice(Whisper)     →  多平台                →  生态集成
        (grammy)                                       (+ Cloudflare Pages)

AI:     DeepSeek V3(主)    →  不变                 →  不变                  →  Fine-tune
        Claude Sonnet(备)      (成本极低，无压力)       (按用量自动扩展)          专有模型
        自动 fallback

存储:   Cloudflare D1      →  D1(加表)             →  D1 / Hyperdrive+PG   →  +时序数据
        (SQLite-compat)                                (视数据量决定)           (OBD/GPS)

调度:   无                 →  CF Cron Triggers     →  CF Cron Triggers      →  事件驱动
                               (Workers 原生)           (多任务)

部署:   CF Workers         →  CF Workers           →  Workers + CF Pages    →  Workers 微服务
        (单 Worker)            (单 Worker)              (Web Dashboard)          拆分

Agent:  S01-S04 精简       →  +S09 记忆层          →  +S06(子 Agent)        →  S15-S17
        (TypeScript)           +Whisper 工具           (异步查询任务)            (多 Agent 团队)
```

### 关键演进原则

1. **全程留在 Cloudflare 生态**：Workers → D1 → KV → Cron Triggers → Pages，各层无缝集成，不引入外部服务除非有明确瓶颈
2. **模型层保持可替换**：DeepSeek/Claude/其他模型通过同一个 `callLLM()` 接口调用，切换不影响上层逻辑
3. **Agent 能力按需引入**：不提前引入 S06 子智能体/S15 多智能体，等单 Loop 遇到明显瓶颈再升级
4. **接口层解耦**：Tool 层与 Bot 层分离，同一套 Tool 既可被 Telegram webhook 调用，也可被未来的 Web API 调用
5. **向上兼容 Schema**：D1 数据库加字段不删字段，保证历史数据不破坏

---

## 10. 非功能性需求

| 指标 | MVP 目标 | 说明 |
|------|---------|------|
| 响应延迟 | < 5 秒 | DeepSeek API ~1-2s + 工具执行 + Telegram 往返 |
| AI 可用性 | 99%+ | DeepSeek 故障自动 fallback 到 Claude |
| 服务可用性 | 99.9%+ | Cloudflare Workers SLA，无需运维 |
| 数据安全 | D1 数据仅白名单 chat_id 可访问 | webhook secret 验证防伪造请求 |
| 日志 | Workers `console.log` → Cloudflare Logpush | Workers Dashboard 可实时查看 |
| 月度费用上限 | < $1/月 | DeepSeek 用量设置控制台限额 |

---

## 11. 开放问题（待决策）

| 问题 | 现状 | 影响 |
|------|------|------|
| 是否记录"加满"标志 | 未设计 | 影响油耗计算精度 |
| 时区处理 | 默认本地时区 | 跨时区使用时日期可能错乱 |
| 对话历史长度 | 保留最近 10 条 | 复杂多轮澄清时可能丢失上下文 |
| 错误记录修改 | 未设计修改/删除功能 | MVP 可接受，Phase 2 补充 |
