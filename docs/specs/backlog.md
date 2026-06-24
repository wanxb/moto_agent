# 功能 Backlog（概览级简报）

> 这里是尚未详写三件套的功能的**概览级简报**。当某功能进入开发，从 [`_template/`](_template/) 创建 `NNN-功能名/` 三件套并升级状态。
> 优先级与依赖来自 [`../product/roadmap.md`](../product/roadmap.md)。

每条简报含：价值、范围要点、关键设计方向、依赖、对各文档的影响。

---

## 维修保养记录 → 已升级为 [spec 002](002-maintenance/)

> 已从概览升级为完整规格并实现（✔️ 待部署）。详见 [`002-maintenance/`](002-maintenance/)。

---

## 定时提醒（保养/保险）

> 🔜 **下一个开发目标**（P1，依赖维保记录 ✔️ 已就绪）。

- **阶段/优先级**：Phase 2 · P1 · 🟡 概览
- **价值**：高——主动提醒换机油里程、保险到期，避免漏保养。
- **范围**：基于里程阈值或日期触发主动推送；可设置/查看/取消提醒。
- **设计方向**：
  - 引入 **Cloudflare Cron Triggers**（`wrangler.toml` `[triggers] crons`），新增定时入口扫描到期提醒（替代教程 S13/S14 后台任务，见 [agent-design §6](../engineering/agent-design.md)）。
  - 新表 `reminders`（`vehicle_id`、`type`、`trigger_odometer`/`trigger_date`、`status`）。
  - 里程类提醒需当前里程估算（最近记录 + 日均里程）或在每次记录后检查阈值。
  - 主动推送经 Telegram Bot API `sendMessage`（需存目标 `chat_id`）。
- **依赖**：维保记录（提醒挂在保养项上）、多车。
- **影响**：[architecture](../engineering/architecture.md)（新增 Cron 入口）、[observability-ops §6](../engineering/observability-ops.md)、[security](../engineering/security.md)（定时任务也要受控）。

---

## 记录纠错/删除

- **阶段/优先级**：Phase 2 · P2 · 🟡 概览
- **价值**：中——数据质量，记错能改（[S11](../product/personas.md#体验类)）。
- **范围**：修改/删除最近一条或指定记录的字段。
- **设计方向**：
  - 新工具 `update_last_record` / `delete_record`。
  - **不物理删历史**优先用软删除（`is_deleted` 列）以守"只增不删"精神；或允许 UPDATE 但记审计。
  - 需明确"哪一条"的指代（最近一条 / 按日期里程定位）。
- **依赖**：无（但与多车叠加时要定位到正确车的记录）。
- **影响**：[data-model](../engineering/data-model.md)、[agent-design](../engineering/agent-design.md) §2。

---

## 语音输入

- **阶段/优先级**：Phase 2 · P2 · 🟡 概览
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

## Web Dashboard（Phase 3）

- **阶段/优先级**：Phase 3 · 🟡 概览
- **价值**：可视化油耗趋势/费用分布，服务非技术用户（[Persona B](../product/personas.md#persona-b省心骑手非技术用户phase-3-目标)）。
- **范围**：只读图表面板（油耗趋势、费用、月度对比）。
- **设计方向**：
  - **Cloudflare Pages** 承载前端，复用同生态，读 D1。
  - 鉴权：Telegram Login Widget 或 Workers 签发 JWT（**先写 ADR**）。
  - 复用 Tool/数据层（接口层解耦原则），不重写业务逻辑。
- **依赖**：多用户数据隔离（[security §6](../engineering/security.md)）。
- **影响**：架构新增容器、新 ADR、[security](../engineering/security.md) 多用户设计。

---

## 待补充（Phase 4 设想）

OBD 接入、GPS 轨迹、AI 异常检测、社区横向对比、多平台（企业微信/微信）——见 [`../../PRD.md`](../../PRD.md) §8 Phase 4，进入规划时再建简报。
