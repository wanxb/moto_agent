# ADR-0010：前端架构 — Svelte SPA + Vite，由 Worker 经 Static Assets 托管

**状态**：✅ Accepted（spec 016 落地） · **日期**：Phase 3 · **关联/演进**：取代 [ADR-0009](0009-phase3-dashboard.md) 的「前端交付方式」部分（API 设计与鉴权演进方向不变）

## 背景

ADR-0009 在「只有一个只读 Dashboard 页面」时，选了最省事的交付方式：HTML 写在 `src/routes/dashboard-html.ts` 里、由 Worker 返回内联字符串。当时就埋了 Plan B：「页面变多时迁到 Pages/Static Assets，API 不动」。

spec 016（多用户 PWA）把前端从 1 个只读页扩成 4 个页面、且其中 `/chat` 是真·交互应用：

- **多页面共享**：顶栏、设计 token、`<head>` 注入、双语切换要在 chat / login / settings / dashboard 间复用——字符串模式只能复制粘贴。
- **客户端状态**：chat 有历史渲染、滚动管理、`MediaRecorder` 录音状态机、发送/错误态——裸 DOM + 拼字符串会迅速失控。
- **工程化缺失**：模板无类型检查、无组件化、转义易错、无 HMR 开发体验。

字符串内嵌模式在这个规模下是负债。

## 决策

**新建 `web/` 前端子项目，用 Vite + Svelte 构建成静态资源，由现有 Worker 经 `[assets]` 绑定托管。Worker 退回成纯 API + Bot webhook + auth 端点。**

不另起独立部署的服务、不引入后端框架、不迁移基础设施——**仍是单 Worker、仍 100% 在 Cloudflare 生态内**。

### 架构

```
moto-agent.<...>.workers.dev   ← 单个 Worker
  │
  ├─ 动态路由（Worker 代码，src/index.ts）
  │    ├── POST /telegram            Bot webhook
  │    ├── POST /auth/send-link      发魔法链接（Resend）
  │    ├── GET  /auth/verify         一次性 token 确认页（最小服务端 HTML，防扫描器预取）
  │    ├── POST /auth/verify         消费 token → 建 session → Set-Cookie → 302
  │    ├── POST /auth/bind /logout   绑定 / 登出
  │    ├── POST /chat/api /voice     对话 / 语音
  │    └── GET  /api/v1/*            仪表盘只读数据
  │
  └─ 静态资源（[assets]，web/dist/）
       ├── /            → SPA shell（index.html）
       ├── /login /chat /settings /dashboard  → SPA 客户端路由（SPA 兜底到 index.html）
       └── /manifest.json /assets/*           → 构建产物
```

### 技术选型

| 维度 | 选型 | 理由 |
|------|------|------|
| 框架 | **Svelte** | 编译期消解框架、运行时极小，最贴本项目「单依赖、极简、移动端」的调性；组件化 + 响应式刚好覆盖 chat 交互 |
| 构建 | **Vite** | 标准、快、SPA/静态产物开箱即用；`devDependency`，**不进 Worker 生产依赖** |
| 托管 | **Workers Static Assets**（wrangler `[assets]`） | 同一 Worker 同一次 `npm run deploy` 吐静态资源 + 跑动态路由，不另起服务、不迁基础设施 |
| 样式 | 复用现有 `:root` 设计 token（`--bg/--card/--accent`…）抽到 `theme.css` | 与现有 dashboard 视觉一致，深色 + 移动端优先 |
| 鉴权 | SPA shell 公开，**鉴权在 API 层**（session cookie，401 → 客户端跳 `/login`） | 静态 SPA 无法做服务端 HTML 重定向；改由 API 401 + 客户端路由守卫，标准 SPA 模式 |

> 与 ADR-0009 的差异：0009 是「Worker 返回 HTML 字符串 + 页面级 token 鉴权」；本 ADR 是「构建产物当静态资源 + API 层 session 鉴权」。**API 端点设计与数据隔离不变**，只换前端交付与鉴权落点。

### 鉴权落点的变化（关键）

字符串模式下，`/chat` 这类页面请求由 Worker 中间件校验 session、无 session 就 302 到登录页。**静态 SPA 模式下不再这样**：

- SPA shell（HTML/JS）对所有人公开返回——里面没有用户数据，只是壳。
- 真正的数据都走 `POST /chat/api`、`GET /api/v1/*`，这些端点校验 session cookie，无效则 **401**。
- 前端收到 401 → 客户端路由跳 `/login`。
- 唯一的例外是 `GET /auth/verify`（邮件链接直达），它仍是 Worker 返回的**最小服务端 HTML 确认页**（防邮件安全网关预取一次性 token，见 spec 016 design §3.1），不属于 SPA。

### 迁移边界（控制本期范围）

- 现有 `src/routes/dashboard-html.ts` **暂保留可用**，仪表盘作为 SPA 的一个路由逐步迁入；本期先打通 chat/login/settings 三页 + 鉴权，dashboard 迁移可在 SPA 落地后跟进，避免一次性大爆炸。
- `src/routes/api.ts`（只读数据 API）**不重写**，仅按 spec 016 加 session 鉴权 + `user_id` 过滤。

## 备选方案

- **保留字符串内嵌 + 抽公共模板函数**：改动最小、零新工具，但组件化/类型安全/客户端状态仍缺位，只是把问题往后推。否决（治标）。
- **无框架 Vite + lit-html/web components**：概念负担更小，但 chat 的响应式状态要手写管理，比框架啰嗦。否决（chat 交互收益不抵省下的运行时）。
- **React SPA**：生态最熟，但运行时最重，与「单依赖极简」调性偏离最大。否决（偏重）。
- **Cloudflare Pages 独立部署**：同生态，但多一个部署目标与配置面；Static Assets 能在同一 Worker 内达成同样效果，更简。否决（够用即止）。
- **Next.js / Nuxt / VPS**：过度工程。否决（YAGNI + 生态一致原则）。

## 影响

- 新增 `web/` 子项目与 Vite/Svelte **devDependencies**；生产依赖仍只有 `grammy`（CLAUDE.md §7 红线不破）。
- 新增构建步骤：部署链路变成 `npm run build`（前端）→ `npm run deploy`（Worker + assets）。需更新 CLAUDE.md §3 常用命令、README、`wrangler.toml` 加 `[assets]`。
- `tsc` 仍是 Worker 侧门禁；前端侧由 `svelte-check` + Vite 构建兜类型/编译。

## 关联

[ADR-0009](0009-phase3-dashboard.md)（前端交付方式被本 ADR 取代） · [architecture](../architecture.md) · [security](../security.md) · [spec 016 design §4/§6](../../specs/016-multi-user-pwa/design.md)。
