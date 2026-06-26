# 规格驱动开发（SDD）

> 本目录是功能开发的**规格层**。任何非平凡功能：**先写规格，再写代码。**
> AI 编码助手必读 [`../../CLAUDE.md`](../../CLAUDE.md) §5。

---

## 1. 为什么 SDD

LLM/AI 编码助手在"有清晰规格"时表现远好于"模糊指令"。SDD 把需求拆成三份可被人和 AI 共同消费的文档，让意图、设计、任务都可追踪、可验收：

```
需求 (requirements)  →  设计 (design)  →  任务 (tasks)  →  实现 (code)
  做什么/为谁/验收        怎么做/数据/接口     可执行清单       按 tasks 编码
```

---

## 2. 三件套

每个功能一个目录 `NNN-功能名/`，含三个文件（模板见 [`_template/`](_template/)）：

| 文件 | 回答 | 关键内容 |
|------|------|---------|
| `requirements.md` | **做什么** | 用户故事、验收标准（Given/When/Then）、范围与非目标 |
| `design.md` | **怎么做** | 数据模型变更、工具契约、Prompt 影响、流程、风险 |
| `tasks.md` | **按什么顺序做** | 有序、可勾选、每条可独立验证的任务，含测试项 |

---

## 3. 工作流

```
1. 立项     在 specs/ 建 NNN-功能名/，从 _template/ 复制三件套
2. 需求     写 requirements.md → 与需求方对齐验收标准
3. 设计     写 design.md → 对照 engineering/ 文档与约束（schema 只增不删、工具契约…）
4. 拆解     写 tasks.md → 有序任务 + 每条的测试/验收
5. 实现     按 tasks.md 逐条做，勾选；遵守 CLAUDE.md 约定
6. 验收     DoD 全绿（type-check + test），更新受影响文档
7. 归档     标记 spec 状态为 Done
```

> 中等复杂度功能可简化（requirements + tasks 合并），但**多车/维保/提醒这类涉及数据模型或多文件的，三件套齐全**。

---

## 4. 规格索引

| # | 功能 | 状态 | 阶段 | 链接 |
|---|------|------|------|------|
| 001 | 多车管理 | ✔️ 已实现（待部署） | Phase 2 P0 | [001-multi-vehicle/](001-multi-vehicle/) |
| 002 | 维修保养记录 | ✔️ 已实现（待部署） | Phase 2 P1 | [002-maintenance/](002-maintenance/) |
| 003 | 定时提醒 | ✔️ 已实现（待部署） | Phase 2 P1 | [003-reminders/](003-reminders/) |
| 004 | 记录纠错/删除 | ✔️ 已实现（待部署） | Phase 2 P2 | [004-record-edit/](004-record-edit/) |
| 005 | 车辆改名 + 纯文本输出 | ✔️ 已实现 | Phase 2 P2（体验） | [005-rename-and-plaintext/](005-rename-and-plaintext/) |
| 006 | 质量加固（埋点/续期/评测） | ✔️ 已实现（待部署） | Phase 2 P2（加固） | [006-hardening/](006-hardening/) |
| 007 | 提醒去重 + 会话回合截断（修复） | ✔️ 已实现 | Phase 2 P1（修复） | [007-reminder-replace-and-context/](007-reminder-replace-and-context/) |
| 008 | 语音输入（Workers AI Whisper） | ✔️ 已实现（待部署+冒烟） | Phase 2 P2 | [008-voice-input/](008-voice-input/) |
| 009 | 车辆别名（简称） | ✔️ 已实现（待部署） | Phase 2 P2（体验） | [009-vehicle-alias/](009-vehicle-alias/) |
| 010 | 国际化（中英双语） | ✔️ Done | Phase 2 末 | [010-i18n/](010-i18n/) |
| 011 | 车辆属性扩展（品牌/型号/油号/油箱容量/颜色） | ✔️ Done | Phase 2 P2（体验） | [011-vehicle-attributes/](011-vehicle-attributes/) |
| 012 | 架构重构 — 路径统一 + 遗留代码清理 | ✔️ Done | Phase 2 加固 | [012-arch-refactor/](012-arch-refactor/) |
| 013 | 分层模型路由（简单→Flash，复杂→Pro） | ✔️ Done | Phase 2 加固 | [013-model-routing/](013-model-routing/) |
| 014 | DeepSeek 模型迁移（deepseek-chat → v4-flash） | ✔️ Done | Phase 2 加固 | [014-deepseek-migration/](014-deepseek-migration/) |
| 015 | 摩托车知识库 RAG | ✔️ Done | Phase 3 | [015-knowledge-rag/](015-knowledge-rag/) |
| 016 | 多用户 PWA — 邮箱认证 + 对话式 Web 界面 | 🚧 开发中（T1–T12 完成，待部署 T13.8） | Phase 3 P0 | [016-multi-user-pwa/](016-multi-user-pwa/) |
| — | 语音输入 | 🟡 概览 | Phase 2 P2 | [backlog.md](backlog.md#语音输入) |
| — | 数据导出 | 🟡 概览 | Phase 2 P3 | [backlog.md](backlog.md#数据导出csv) |
| — | Web Dashboard | 🟡 概览 | Phase 3 | [backlog.md](backlog.md#web-dashboardphase-3) |

> 状态流转：🟡 概览（backlog） → 📝 规格中（三件套撰写） → ✅ 待开发 → 🚧 开发中 → ✔️ Done。

---

## 5. 与其它文档的关系

- 规格的**优先级**来自 [`../product/roadmap.md`](../product/roadmap.md)。
- 规格的**设计约束**来自 [`../engineering/`](../engineering/)（架构、数据模型、Agent 设计、安全）。
- 规格的**完成标准**来自 [`../process/definition-of-done.md`](../process/definition-of-done.md)。
