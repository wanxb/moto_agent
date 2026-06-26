# 需求：重复录入软拦截 + 删除扩展到任意记录

> 规格 017 · 状态：✔️ 已实现（待线上部署） · 阶段：Phase 2 收尾 · 优先级：P2
> 关联：[design.md](design.md) · [tasks.md](tasks.md) · 复用 [spec 004](../004-record-edit/) 软删除模式

## 1. 问题陈述

两个真实缺口（清理保养里程数据时发现）：

1. **写入零去重**：`log_fuel` / `log_maintenance` 直接 insert。线上已产生重复——2026-06-25 有两条几乎相同的「轮胎/补胎」记录（同日、同类型、里程均空、备注仅差一字）。重复数据污染统计与历史。
2. **删除能力极弱**：仅 `delete_last_fuel` 能删「默认车最近一条加油」。`maintenance_records` 连 `deleted_at` 列都没有，更无删除工具——重复保养在对话里删不掉，只能直接改库。删除前也无二次确认，LLM 误判即误删。

## 2. 用户故事

- **US1（去重提示）** 作为骑手，重复记录同一次加油/保养时，希望系统提示"疑似重复"并等我确认，而不是静默写两条。
- **US2（坚持记录）** 作为骑手，确实要记两条相近记录时，确认后应能正常写入。
- **US3（删保养）** 作为骑手，我想用自然语言删掉某条错误/重复的保养记录。
- **US4（删重复只留一条）** 作为骑手，对同日同类型的重复记录，我想说"删掉重复的只留一条"。
- **US5（删除确认）** 作为用户，任何删除操作执行前都应回显记录并要我确认，避免误删。
- **US6（可恢复）** 作为用户，删除是软删除，可运维侧恢复。

## 3. 范围

**In Scope**
- `log_fuel` / `log_maintenance` 写入前去重软拦截 + `confirm` 跳过。
- `maintenance_records` 加 `deleted_at` 软删除（迁移 0008），所有读路径过滤。
- 新工具 `delete_maintenance`（按类型/日期定位 + `keep_one` 去重）、`delete_fuel`（按日期/里程定位任意加油记录）。
- `delete_last_fuel` 加两步 `confirm` 确认。
- 删除前一律预览 + 确认（`confirm` 两段式）。

**Out of Scope**
- 维保记录字段编辑工具（本期只去重 + 删除）。
- 多用户归属校验（Phase 3 / spec 016）。
- 对话式 undo 恢复（恢复走运维 DB）。

## 4. 验收标准（Given / When / Then）

- **AC1（加油去重）** Given 某车某日已有里程 10000 的记录，When 再记同日里程 10001（差≤阈值），Then 返回"疑似重复"且不落库。
- **AC2（确认写入）** When 上述场景带 `confirm=true`，Then 正常写入。
- **AC3（非重复）** When 同日里程相差大（如 200km），Then 不拦截，正常写入。
- **AC4（保养去重）** Given 同车同类型且日期差≤1 天已有记录，When 再记，Then 提示"疑似重复"且不落库。
- **AC5（软删过滤）** Given 一条保养记录被软删，Then `query_maintenance` / `getMaintenanceRecords` / `getLastMaintenanceByType` 都不再返回它。
- **AC6（删除两步）** When 调 `delete_maintenance`/`delete_fuel`/`delete_last_fuel` 不带 `confirm`，Then 返回预览不删；带 `confirm=true` 才软删。
- **AC7（keep_one）** Given 同日同类型 2 条重复，When `delete_maintenance(keep_one=true, confirm=true)`，Then 保留最早一条、软删其余。
- **AC8（多条歧义）** When 多条匹配且未传 `keep_one`，Then 列出让用户缩小范围，不删。
- **AC9（未找到）** When 定位不到记录，Then 提示未找到。

## 5. 交互示例

```
用户：6-25 补胎
Bot：⚠️ 疑似重复保养记录
     2026-06-25 附近已有一条「轮胎」记录。
     确认要继续记录吗？回复"确认"继续。

用户：删掉 6-25 重复的补胎，只留一条
Bot：⚠️ 找到 2 条重复保养记录，将保留最早一条、删除其余 1 条：
     2026-06-25 · 轮胎 · — · — · 后胎被扎补胎
     回复"确认"继续。
用户：确认
Bot：🗑 已删除 1 条重复保养记录，保留最早一条。
     （如需恢复请联系管理员）
```

## 6. 依赖与假设

- 依赖：spec 001（车辆解析）、spec 004（软删除模式）。
- 假设：去重阈值——加油同日里程差 ≤ `FUEL_DUP_KM_THRESHOLD`(2km)；保养同类型日期差 ≤ `MAINT_DUP_DAYS`(1 天)。
- 假设：`confirm` 两段式依赖 KV 会话历史持久化，确认轮能看到上一轮预览。
