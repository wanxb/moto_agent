# 测试策略

> 框架：`vitest` + `@cloudflare/vitest-pool-workers`（真实 Miniflare，含 D1/KV）。当前 205 个测试，覆盖 LLM、工具逻辑、多车/维保/提醒/纠错、语音 STT、会话持久化、Webhook 鉴权。
>
> **测试用 `wrangler.test.toml`**（非生产 `wrangler.toml`）：去掉 `[ai]` 绑定——Workers AI 需外部代理，本地测试运行时无法解析（`__WRANGLER_EXTERNAL_AI_WORKER`）。语音测试 mock `env.AI`（`test/stt.test.ts`）。改生产 bindings 时注意两份配置一致。

---

## 1. 测试金字塔

```
        ╱╲        端到端（手动）：真实 Telegram → 部署的 Worker
       ╱  ╲       —— 部署后冒烟，不自动化
      ╱────╲      集成：webhook 鉴权、KV 会话往返、Agent Loop + mock LLM
     ╱      ╲     —— test/session.test.ts、test/agent.test.ts
    ╱────────╲    单元：工具逻辑、SQL、油耗计算、格式转换
   ╱__________╲   —— test/tools.test.ts、database.test.ts、llm.test.ts
```

重心在**单元 + 集成**，端到端靠部署后手动冒烟（[`observability-ops.md`](observability-ops.md)）。

---

## 2. 测试文件职责

| 文件 | 覆盖 |
|------|------|
| `test/tools.test.ts` | 工具分发、油耗计算、统计聚合、边界（除零/负里程/空数据） |
| `test/database.test.ts` | D1 CRUD、排序（按 odometer）、日期范围查询 |
| `test/llm.test.ts` | DeepSeek/Anthropic 调用、重试、fallback、消息格式互转 |
| `test/session.test.ts` | KV 读写、历史截断、会话持久化 |
| `test/agent.test.ts` | Agent Loop 轮次、工具回灌、终止条件 |
| `test/i18n.test.ts` | 翻译函数 `t()`、语言切换 `set_language` 工具、工具描述中英双选（spec 010） |
| `test/vehicle-attributes.test.ts` | 车辆属性 CRUD（brand/model/fuel_type/tank_capacity/color）工具（spec 011） |
| `test/utils.ts` | 共享：`initDB` / `clearDB` / `makeEnv`（**改 schema 时同步**） |

---

## 3. 黄金规则

1. **LLM 必须 mock。** 绝不在测试里打真实 DeepSeek/Anthropic（成本 + flaky + 不确定）。用 `fetch` mock 返回固定 response。
2. **DB 测试用 Miniflare 真实 D1。** 用 `initDB` 建表、`clearDB` 隔离，每个用例独立。
3. **新功能 = 新测试。** 工具新增必带 `tools.test.ts` 用例。
4. **Bug 先写复现测试。** 红 → 修 → 绿。
5. **测业务，不测框架。** 不测 grammY/wrangler 本身，测我们的逻辑。

---

## 4. 各层测试要点

### 工具层（重点）
- 正常路径 + 边界：除零（`liters=0`）、负/零区间里程、空记录集、单条记录（无法算区间）。
- 计算正确性：油耗 = 上次 liters / 区间 km × 100；单价 = total/liters。
- 返回文案格式（emoji、数字格式化）。

### LLM 层（重点，改 llm.ts 必测）
- DeepSeek 正常返回 text / tool_calls。
- 重试：429/5xx 触发退避重试；4xx 立即抛不重试。
- fallback：DeepSeek 3 次失败后切 Anthropic。
- 格式互转：OpenAI ⇄ Anthropic，特别是 `tool_use`/`tool_result` 配对、连续 tool 消息合并。

### 会话层
- KV 空时按空历史处理。
- 截断到 `MAX_SESSION_MESSAGES`。
- system prompt 不入持久历史。

### 鉴权（集成）
- 缺/错 webhook secret → 401。
- 非白名单 `chatId` → 拒绝。

---

## 5. LLM 行为评测（解析准确率）

LLM 的"自然语言 → 正确字段"能力**不能靠单测**（mock 掉了），需独立**评测集**保障 [解析准确率 > 95%](../product/metrics.md)：

- 维护一组真实风格输入 → 期望工具调用/参数的样例（如"加了10升花98里程12580" → `log_fuel{liters:10, price_total:98, odometer:12580}`）。
- ✅ 已落地（spec 006）：`test/eval/cases.json` 用例集 + `scripts/eval.ts` 评测器。
  ```bash
  npm run eval   # 需 .dev.vars 或环境变量里的 DEEPSEEK_API_KEY；不进 npm test
  ```
  对每条真实风格输入调真实模型，校验「工具名 + 关键参数」，输出通过率（阈值 95%，低于则退出码非零）。
- 用例覆盖：记录/查询/多车指代/维保/提醒/纠错/改名。
- 关注：字段提取准确率、不必要澄清率、多车场景指代正确率。

> 评测**不进 CI 门禁**（需真实 key、有成本/不确定性），作为手动回归手段。

---

## 6. 运行

```bash
npm test            # 全部，CI 门禁
npm run test:watch  # 开发监听
npm run test:ui     # vitest UI
npm run type-check  # tsc，静态门禁（等价于 lint）
```

**完成定义**：`type-check` + `test` 全绿（见 [`../process/definition-of-done.md`](../process/definition-of-done.md)）。

---

## 7. 覆盖目标（务实）

- 不追求行覆盖百分比数字，追求**关键路径 + 边界**全覆盖。
- 必覆盖：所有工具的正常+边界、LLM fallback、鉴权、会话截断。
- 新增功能的 spec `tasks.md` 应显式列出要补的测试项。
