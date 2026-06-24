# 任务：多车管理

> 规格 001 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。顺序执行，每条勾选前确认验证项通过。
>
> **状态：T1–T11 已完成；T12（线上部署）待执行。** 测试：70 passed（49 既有 + 21 新增 `test/vehicles.test.ts`）。

## 阶段 A — 数据模型与迁移

- [x] **T1 迁移脚本**：建 `migrations/0001_multi_vehicle.sql`（vehicles 表 + `vehicle_id` 列 + 索引 + 存量回填，见 [design §2/§7](design.md)）。
  - ✅ 已在本地 D1 验证：旧库灌入 2 条记录 → 跑迁移 → 自动建默认车「我的摩托」+ 两条记录回填 `vehicle_id=1`（AC8）。
  - 注：`ALTER TABLE ADD COLUMN` 非幂等（SQLite 限制），为一次性前向迁移；数据回填带 WHERE 守卫可重入。
- [x] **T2 schema.sql 同步**：新库含 vehicles 表与记录表 `vehicle_id` 列 + 索引。
  - ✅ 本地 `--file=docs/schema.sql` 重置验证，4 张表就位。
- [x] **T3 test/utils.ts 同步**：`initDB` 加 vehicles + `vehicle_id`；`clearDB` 加 `DELETE FROM vehicles`。
  - ✅ 既有 49 测试全绿。

## 阶段 B — 数据访问层（database.ts）

- [x] **T4 vehicles CRUD**：`insertVehicle` / `getVehicleByName` / `listVehicles` / `getDefaultVehicle` / `setDefaultVehicle`（batch 原子）/ `countVehicles`。
  - ✅ `test/vehicles.test.ts` 覆盖，含默认车唯一性（原子切换）。
- [x] **T5 记录函数加车辆维度**：`insert*` 写 `vehicle_id`；`getLastFuelRecord`/`getRecentFuelRecords`/`getFuelRecordsByDateRange` 加可选 `vehicle_id` 过滤。
  - ✅ 覆盖按车过滤 + **跨车里程不相减** 用例。

## 阶段 C — 工具层（tools.ts）

- [x] **T6 `resolveVehicle(db, name?)` helper**：指定→精确匹配；未指定→默认车；多车无默认→歧义；**无车辆→单车/历史模式（不过滤）**（见 [design §3/§8](design.md)）。
  - ✅ `test/vehicles.test.ts` 覆盖各路径。
- [x] **T7 新增工具**：`add_vehicle` / `list_vehicles` / `set_default_vehicle`（定义 + dispatch + 实现）。
  - ✅ 覆盖首辆自动默认、重复同名提示、空列表提示、切换默认。
- [x] **T8 改造记录/查询工具**：四工具加可选 `vehicle` 参数，经 `resolveVehicle` 解析，回显车名。
  - ✅ 覆盖 AC2/AC3/AC4/AC5 指定/默认/歧义；统计按车隔离。

## 阶段 D — Prompt 与编排

- [x] **T9 system prompt**：`agent.ts buildSystemPrompt` 增多车规则 6–8 条（见 [design §4](design.md)）。

## 阶段 E — 测试与文档

- [x] **T10 迁移与回归测试**：存量迁移本地验证（AC8）；单车未指明不反问的回归（`legacy single-vehicle mode` 用例）。
  - ✅ `npm test` 70 passed。
- [x] **T11 文档更新**：`data-model.md` §1/§5/§7、`agent-design.md` §2、本 spec/索引/`docs/README.md` 状态。
- [ ] **T12 部署迁移**：线上执行 `wrangler d1 execute moto-agent-db --remote --file=migrations/0001_multi_vehicle.sql` + 冒烟（[observability-ops §3.3/§3.4](../../engineering/observability-ops.md)）。
  - ⏳ 待执行（需线上凭证/用户确认上线时机）。

## 验收（Definition of Done）

- [x] 验收标准 AC1–AC8：AC1/AC6/AC7（车辆管理）、AC2/AC3/AC4/AC5（解析与统计）、AC8（迁移）均经测试或本地迁移验证。
- [x] `npm run type-check && npm test` 全绿（type-check exit 0；70 tests passed）。
- [x] 存量数据零损失（迁移前后记录完整回填）。
- [x] 受影响文档同步更新。
- [x] 遵守 [安全清单](../../engineering/security.md) §7（全参数化绑定、无 secret）。

> **type-check 注**：原 `tsc` 报 2 条 grammy 库 `.d.ts` 噪声（`node-fetch`/`fs`，pre-existing）。已在 `tsconfig.json` 加 `skipLibCheck: true` 消除——该选项只跳过第三方 `.d.ts`，本项目 `.ts` 源码仍全量类型检查。
