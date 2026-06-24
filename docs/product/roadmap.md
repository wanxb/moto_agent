# 产品路线图

> 本文件在 [`../PRD.md`](../PRD.md) §8 路线图基础上，补充**优先级理由、里程碑与依赖关系**，作为规划 [`../specs/`](../specs/) 的依据。

---

## 阶段总览

| 阶段 | 主题 | 时间锚点 | 状态 |
|------|------|---------|------|
| **Phase 1** | MVP：跑通核心链路 | 已完成 | ✅ Done |
| **Phase 2** | 功能完善：扩展记录维度与便利性 | 2026 H1 | ✅ 已完成（代码+测试落地，待线上部署） |
| **Phase 3** | 多用户 + 可视化 | 2026 末 – 2027 H1 | 📋 规划 |
| **Phase 4** | 智能化与生态 | 2027+ | 💭 设想 |

---

## Phase 1 — MVP ✅

跑通：自然语言记录加油 → 解析 → 写 D1 → 算油耗 → 查询统计；DeepSeek 主 / Claude 备自动 fallback。已 49 测试通过、可部署。详见 [`../PRD.md`](../PRD.md) §8。

---

## Phase 2 — 功能完善 🚧（当前）

**目标**：在不改变"对话式个人工具"定位的前提下，扩展记录维度、提升便利性。

### 功能与优先级

按「价值 / 成本 / 依赖」排序：

| 优先级 | 功能 | 价值 | 成本 | 依赖 | 规格 |
|--------|------|------|------|------|------|
| **P0** | 多车管理 | 高（解锁多车用户 + 是其它功能的数据基座） | 中（数据模型变更） | 无 | [`../specs/001-multi-vehicle/`](../specs/001-multi-vehicle/) ✔️ 已实现（待部署） |
| **P1** | 维修保养记录 | 高（高频真实需求） | 中 | 多车（保养绑定到车）✔️ | [`../specs/002-maintenance/`](../specs/002-maintenance/) ✔️ 已实现（待部署） |
| **P1** | 定时提醒（保养/保险） | 高 | 中（引入 Cron Triggers） | 维保记录 ✔️ | [`../specs/003-reminders/`](../specs/003-reminders/) ✔️ 已实现（待部署） |
| **P2** | 记录纠错/删除 | 中（数据质量） | 低 | 无 | [`../specs/004-record-edit/`](../specs/004-record-edit/) ✔️ 已实现（待部署） |
| **P2** | 语音输入 | 中（便利性） | 中（Workers AI Whisper，无需转码） | 无 | [`../specs/008-voice-input/`](../specs/008-voice-input/) ✔️ 已实现（待部署） |
| **P2** | 车辆改名 + 纯文本输出 | 中（体验） | 低 | 无 | [`../specs/005-rename-and-plaintext/`](../specs/005-rename-and-plaintext/) ✔️ 已实现 |
| **P2** | 质量加固（评测/续期） | 中（质量保障） | 中 | 无 | [`../specs/006-hardening/`](../specs/006-hardening/) ✔️ 已实现 |
| **P2** | 提醒去重 + 会话截断 | 中（可靠性修复） | 低 | 提醒 spec 003 | [`../specs/007-reminder-replace-and-context/`](../specs/007-reminder-replace-and-context/) ✔️ 已实现 |
| **P2** | 车辆别名（简称） | 中（体验） | 低 | 多车 spec 001 | [`../specs/009-vehicle-alias/`](../specs/009-vehicle-alias/) ✔️ 已实现（待部署） |
| **P2** | 国际化（中英双语） | 中（多客户端前提） | 中 | 无 | [ADR-0008](../engineering/adr/0008-i18n-bilingual.md) · [spec 010](../specs/010-i18n/) ✔️ 已实现 |
| **P2** | 车辆属性扩展 | 中（数据完整度） | 低 | 多车 spec 001 | [`../specs/011-vehicle-attributes/`](../specs/011-vehicle-attributes/) ✔️ 已实现（待部署） |
| **P3** | 数据导出（CSV） | 低 | 低 | 无 | [`../specs/backlog.md`](../specs/backlog.md) |

> **为什么多车优先**：它是 schema 演进的第一步（引入 `vehicles` 表 + 外键），维保、提醒、未来多用户都要挂在车辆维度上。先把这个数据基座打好，后续功能成本更低。详见 [ADR-0005 演进](../engineering/data-model.md)。

### Phase 2 验收里程碑

- **M2.1** 多车管理：可创建/切换车辆，统计按车隔离。✔️ 代码完成（待部署）。
- **M2.2** 维保记录：可记录并查询保养历史。✔️ 代码完成（待部署，spec 002）。
- **M2.3** 定时提醒：Cron Triggers 跑通，里程/日期阈值触发推送。✔️ 代码完成（待部署，spec 003）。
- **M2.4** 纠错能力：可修改/软删除最近加油记录。✔️ 代码完成（待部署，spec 004）。

### 技术变更（Phase 2）

- D1 新增 `vehicles`、`maintenance_records` 表（只增不删迁移）。
- 引入 Cloudflare **Cron Triggers**（提醒）。
- 可能引入 Whisper API 调用（语音，P2）。

---

## Phase 3 — 多用户 + 可视化 📋

**目标**：从"自用工具"走向"可分享的产品"，服务 [Persona B](personas.md#persona-b省心骑手非技术用户phase-3-目标)。

- 多用户支持：基于 `chat_id` 的数据隔离 + 鉴权。
- Web Dashboard：Cloudflare Pages 承载油耗趋势/费用分布图表。
- 用户/车辆管理页面。

**关键依赖与风险**：
- 多用户隔离要求 Phase 2 的 schema 已为 `user_id` 预留位置（见 [`../engineering/data-model.md`](../engineering/data-model.md) 演进表）。
- 鉴权方案（Telegram Login Widget vs Workers JWT）需先写 ADR。

---

## Phase 4 — 智能化与生态 💭

- OBD 数据接入（实时油耗、故障码）。
- 骑行轨迹（GPS 热力图）。
- AI 异常检测（油耗突增预警）。
- 社区横向对比、多平台（企业微信/微信）。

详见 [`../PRD.md`](../PRD.md) §8 Phase 4。

---

## 演进原则（约束所有阶段）

1. **全程留在 Cloudflare 生态**，除非有明确瓶颈。
2. **模型层可替换**：统一 `callLLM()` 接口。
3. **Agent 能力按需引入**：不提前上多智能体/子智能体。
4. **接口层解耦**：Tool 层独立于 Bot 层，未来可被 Web API 复用。
5. **Schema 向上兼容**：只加不删。

> 这些原则同时写在 [`../PRD.md`](../PRD.md) §9 和 [`../../CLAUDE.md`](../../CLAUDE.md) §7，是硬约束。
