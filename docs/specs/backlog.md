# 功能 Backlog（概览级简报）

> 这里是尚未详写三件套的功能的**概览级简报**。当某功能进入开发，从 [`_template/`](_template/) 创建 `NNN-功能名/` 三件套并升级状态。
> 优先级与依赖来自 [`../product/roadmap.md`](../product/roadmap.md)。

每条简报含：价值、范围要点、关键设计方向、依赖、对各文档的影响。

---

## 维修保养记录 → 已升级为 [spec 002](002-maintenance/)

> 已从概览升级为完整规格并实现（✔️ 待部署）。详见 [`002-maintenance/`](002-maintenance/)。

---

## 定时提醒（保养/保险）→ 已升级为 [spec 003](003-reminders/)

> 已从概览升级为完整规格并实现（✔️ 待部署）。引入 Cloudflare Cron Triggers（首个非 webhook 入口），见 [`003-reminders/`](003-reminders/) 与 [ADR-0006](../engineering/adr/0006-cron-triggers-scheduled.md)。

---

## 记录纠错/删除 → 已升级为 [spec 004](004-record-edit/)

> 已从概览升级为完整规格并实现（✔️ 待部署）。采用软删除（`deleted_at`）守"只增不删"，作用于最近一条加油记录。详见 [`004-record-edit/`](004-record-edit/)。

---

## 去重 + 删除扩展 → 已升级为 [spec 017](017-dedup-delete/)

> 已从概览升级为完整规格并实现（✔️ 待部署）。写入时去重软拦截（log_fuel/log_maintenance + `confirm`）；`maintenance_records` 补 `deleted_at` 软删除（迁移 0008）；新增 `delete_maintenance`（含 `keep_one` 去重）/`delete_fuel`，所有删除两步确认。详见 [`017-dedup-delete/`](017-dedup-delete/)。

---

## 语音输入 → 已升级为 [spec 008](008-voice-input/)

> 已从概览升级为完整规格并实现（✔️ 待部署+冒烟）。用 Cloudflare Workers AI（Whisper）转写，留在 CF 生态、无需转码、无新 key。详见 [`008-voice-input/`](008-voice-input/) 与 [ADR-0007](../engineering/adr/0007-cloudflare-workers-ai-stt.md)。

---

## 语音输入（原概览，已实现）

- **阶段/优先级**：Phase 2 · P2 · ✔️ 已实现
- **价值**：中——加油站戴手套时语音更方便。
- **范围**：接收 Telegram 语音消息（OGG），转文字后走现有解析链路。
- **设计方向**：
  - grammY 监听 `message:voice`，从 Telegram 下载 OGG，调 Whisper（或等价 STT）转文字。
  - 转写文本复用现有 Agent Loop，无需改工具。
  - 注意 Workers 运行时音频处理/体积限制（见 [ADR-0002](../engineering/adr/0002-cloudflare-workers-runtime.md) 约束）；STT 走外部 API 而非本地解码。
- **依赖**：无。
- **影响**：[architecture](../engineering/architecture.md)（新增 voice 入口）、新增外部依赖需评估（[CLAUDE.md §7](../../CLAUDE.md)）。

---

## 数据导出（CSV）

- **阶段/优先级**：Phase 2 · P3 · 🟡 概览
- **价值**：低——偶发备份/外部分析需求。
- **范围**：导出加油/里程记录为 CSV，经 Telegram 文件发送。
- **设计方向**：
  - 新工具 `export_data`：查询记录 → 拼 CSV → grammY `replyWithDocument`。
  - 多车时可选按车或全部。
- **依赖**：无。
- **影响**：[agent-design](../engineering/agent-design.md) §2。

---

## Web Dashboard（Phase 3）→ 已升级为 [spec 016](016-multi-user-pwa/)

> 已从概览升级为完整规格。详见 [`016-multi-user-pwa/`](016-multi-user-pwa/)。Dashboard 作为 PWA 的页面之一内嵌在多用户系统中，鉴权使用邮箱 Magic Link + Session，不另做独立的 Dashboard 鉴权。

---

## 待补充（Phase 4 设想）

OBD 接入、GPS 轨迹、AI 异常检测、社区横向对比、多平台（企业微信/微信）——见 [`../PRD.md`](../PRD.md) §8 Phase 4，进入规划时再建简报。
