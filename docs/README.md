# 文档中心 — 摩托车油耗管理 Agent

本目录是项目的**单一文档事实来源**。MVP 已跑通，文档体系用于支撑 **Phase 2+ 功能扩展**的规范化开发（产品 → 工程 → 规格 → 流程 → AI 协作）。

> AI 编码助手请从根目录 [`../CLAUDE.md`](../CLAUDE.md) 开始。

---

## 文档地图

```
moto_agent/
├── CLAUDE.md / AGENTS.md       Agent 操作手册（AI 编码助手入口）
├── PRD.md                      产品需求文档（master，MVP 定义）
└── docs/
    ├── README.md               ← 你在这里
    ├── product/                产品层：为什么做、给谁做、做到什么程度
    │   ├── personas.md         用户画像 · 场景 · Jobs-to-be-Done
    │   ├── roadmap.md          分阶段路线图与优先级理由
    │   └── metrics.md          成功指标 · 北极星 · 护栏指标
    ├── engineering/            工程层：怎么搭、怎么扩、怎么稳
    │   ├── architecture.md     系统架构与请求生命周期
    │   ├── data-model.md       数据模型与演进/迁移策略
    │   ├── agent-design.md     Agent Loop · 工具契约 · Prompt/LLM 策略
    │   ├── testing-strategy.md 测试金字塔 · 覆盖目标 · LLM 评测
    │   ├── security.md         威胁模型 · 访问控制 · 密钥管理
    │   ├── observability-ops.md 日志 · 监控 · 部署运维手册
    │   └── adr/                架构决策记录（ADR）
    ├── specs/                  规格层：规范驱动开发（SDD）
    │   ├── README.md           SDD 流程与规格索引
    │   ├── _template/          requirements/design/tasks 模板
    │   ├── 001-multi-vehicle/  近期详写规格（多车管理）
    │   └── backlog.md          其余功能的概览级简报
    └── process/                流程层：怎么协作
        ├── coding-standards.md 编码规范
        ├── definition-of-done.md 完成定义（DoD）
        ├── contributing.md     开发/Git/PR 工作流
        └── glossary.md         领域术语表
```

---

## 按角色的阅读顺序

| 角色 | 推荐路径 |
|------|---------|
| **AI 编码助手** | [`../CLAUDE.md`](../CLAUDE.md) → 对应 [`specs/`](specs/) → [`engineering/agent-design.md`](engineering/agent-design.md) |
| **新加入的开发者** | [`../PRD.md`](../PRD.md) → [`engineering/architecture.md`](engineering/architecture.md) → [`process/contributing.md`](process/contributing.md) → [`process/coding-standards.md`](process/coding-standards.md) |
| **要开发某个功能** | [`specs/README.md`](specs/README.md) → 该功能的 `requirements/design/tasks` |
| **产品/需求视角** | [`../PRD.md`](../PRD.md) → [`product/personas.md`](product/personas.md) → [`product/roadmap.md`](product/roadmap.md) → [`product/metrics.md`](product/metrics.md) |
| **想了解某个技术决策** | [`engineering/adr/`](engineering/adr/) |

---

## 文档分层与职责

| 层 | 回答的问题 | 变更频率 | 谁维护 |
|----|-----------|---------|--------|
| 产品层 `product/` + `PRD.md` | 为什么做、给谁、衡量什么 | 低（按 Phase） | 产品负责人 |
| 工程层 `engineering/` | 怎么实现、怎么演进 | 中（随架构变化） | 技术负责人 |
| 规格层 `specs/` | 这个功能具体怎么做 | 高（每个功能一套） | 功能开发者 |
| 流程层 `process/` | 协作怎么进行 | 低 | 全体 |

---

## 文档维护约定

1. **代码即文档的下游**：当代码改动使某份文档过时，**同一个 PR 内**更新文档（见 [`process/definition-of-done.md`](process/definition-of-done.md)）。
2. **决策留痕**：重大技术选择写 [ADR](engineering/adr/)，不在聊天记录里消失。
3. **规格先行**：非平凡功能先有 [`specs/`](specs/) 规格再写代码。
4. **不重复**：`PRD.md` 是产品需求 master，其它文档引用它而非复制。
5. **链接而非粘贴**：跨文档引用用相对链接，保持单一事实来源。

---

## 文档状态总览

| 文档 | 状态 | 说明 |
|------|------|------|
| `PRD.md` | ✅ v0.2 | MVP 产品定义，现有 |
| `engineering/*` | ✅ 初版 | 基于 MVP 实现整理 |
| `engineering/adr/0001-0005` | ✅ 已记录 | MVP 关键决策回溯 |
| `specs/001-multi-vehicle` | ✔️ 已实现 | Phase 2 P0，代码+测试已落地，待线上部署 |
| `specs/002-maintenance` | ✔️ 已实现 | Phase 2 P1，维保记录，代码+测试已落地，待线上部署 |
| `specs/003-reminders` | ✔️ 已实现 | Phase 2 P1，定时提醒（Cron Triggers，首个非 webhook 入口），待部署 |
| `specs/004-record-edit` | ✔️ 已实现 | Phase 2 P2，记录纠错/软删除，待部署 |
| `specs/005-rename-and-plaintext` | ✔️ 已实现 | 上线后反馈：车辆改名 + Telegram 纯文本输出（去 markdown 保 emoji） |
| `specs/006-hardening` | ✔️ 已实现 | 质量加固：指标埋点 + 提醒自动续期 + LLM 评测集（`npm run eval`） |
| `specs/007-reminder-replace-and-context` | ✔️ 已实现 | 修复：set_reminder 同类替换不叠加 + 会话历史按回合截断 |
| `specs/008-voice-input` | ✔️ 已实现 | 语音输入：Telegram 语音→Workers AI Whisper→现有链路，回显识别文本 |
| `specs/009-vehicle-alias` | ✔️ 已实现 | 车辆别名/简称（如"Honda NS125LA"→"小拉"），待部署 |
| `specs/010-i18n` | 📋 Planned | 国际化中英双语，KV 存语言偏好，待实施 · [ADR-0008](engineering/adr/0008-i18n-bilingual.md) |
| `specs/backlog.md` | 🟡 概览 | 其余功能（导出/Dashboard）待详写 |
| `product/*` · `process/*` | ✅ 初版 | — |
