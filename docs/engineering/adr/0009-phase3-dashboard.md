# ADR-0009：Phase 3 Web Dashboard — Cloudflare Worker 内嵌 + Chart.js

**状态**：✅ Implemented ·  **日期**：Phase 3

## 背景

Telegram Bot 解决了即时记录与查询，但油耗趋势、费用分布、多车对比等需要一个可视化的 Web Dashboard。数据在 D1 中已齐全，只需一个只读的前端消费它。

## 决策

**在 Worker 内加只读 REST API + 一个内嵌静态 HTML 页面（Chart.js）**，初期不引入 Cloudflare Pages。

### 架构

```
moto-agent.wtg2021.workers.dev
  ├── POST /telegram            Bot webhook（现有）
  ├── POST /api/v1/chat         REST 对话（R3 已实现）
  ├── GET  /api/v1/stats        油耗统计数据
  ├── GET  /api/v1/vehicles     车辆列表
  ├── GET  /api/v1/reminders    活跃提醒一览
  └── GET  /dashboard            前端 HTML 页面（内嵌）
```

### 技术选型

| 层 | 选型 | 理由 |
|----|------|------|
| 前端 | 纯 HTML + Chart.js（CDN 直引） | 不需要框架；图表需求简单 |
| 鉴权 | URL token 参数，比对 `DASHBOARD_TOKEN` secret | 单用户阶段最简单 |
| 部署 | 与 Worker 同仓库、同部署 | 不引入新服务（Pages 可延后） |

### 鉴权方案

- 初期（单用户）：`GET /dashboard?token=xxx`，Worker 从中取 token 并传递到每个 API 请求。若 `token` 不匹配 → 401。`DASHBOARD_TOKEN` 存为 Worker Secret。
- 多用户后：改为 JWT（`POST /api/v1/auth` → `{ token }`，前端存 localStorage），鉴权中间件独立可换。

### API 设计（只读，JSON）

| 端点 | 参数 | 返回 |
|------|------|------|
| `GET /api/v1/stats` | `?days=90&vehicle=小拉` | `{ records: [{date,odometer,liters,consumption,cost}], avg, totalKm, totalCost }` |
| `GET /api/v1/vehicles` | — | `{ vehicles: [{name,alias,latestOdometer,lastFuelDate}] }` |
| `GET /api/v1/reminders` | — | `{ reminders: [{type,mode,trigger,status,vehicle}] }` |

> 所有 API 均需 token 鉴权；不带有效 token 返回 401。

### 前端页面

单文件 `public/dashboard.html`（`wrangler.toml` 通过 `[assets]` 或直接 `fetch()` 返回内联 HTML）：

- 语言切换（中/英）
- 油耗趋势折线图（Chart.js line）
- 费用分布饼图（油费 vs 保养 vs 其他）
- 车列表 + 里程
- 活跃提醒一览

### 开发量

| 组件 | 行数（估） | 文件 |
|------|----------|------|
| 3 个 API handler | ~80 | `src/routes/api.ts`（新建） |
| token 鉴权中间件 | ~20 | `src/routes/middleware.ts` |
| Chart.js 前端 | ~200 | `public/dashboard.html` |
| secret 配置 | 1 | `wrangler.toml` / `wrangler secret put` |

## 备选方案

- **Cloudflare Pages 独立部署**：与 Worker 同生态，适合未来多页面/复杂前端，但单页面阶段增加部署复杂度。Plan B：Dashboard HTML 先放 Worker 里，页面变多时迁到 Pages，API 不动。
- **Next.js / Nuxt / VPS**：过度工程。否决（YAGNI + 生态一致原则）。

## 关联

[architecture §7](../architecture.md) · [security §6](../security.md) · [R3 REST API](../../src/gateway/adapters/rest.ts)。
