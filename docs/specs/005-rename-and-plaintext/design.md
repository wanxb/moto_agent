# 设计：车辆改名 + 纯文本输出

> 规格 005 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[agent-design](../../engineering/agent-design.md) · [architecture](../../engineering/architecture.md)

**无数据库结构变更**：改名是 `UPDATE vehicles.name`；纯文本是输出层清洗。

## A. 车辆改名

### 数据访问层
- `renameVehicle(db, id, newName)` → `UPDATE vehicles SET name = ? WHERE id = ?`（参数化）。

### 工具
| 工具 | 参数 | 作用 |
|------|------|------|
| `rename_vehicle` | `name`（现名，必填）, `new_name`（新名，必填） | 改车名 |

实现：
1. `getVehicleByName(db, name)` → 无 → "没有找到车辆「name」"（AC-A4）。
2. `getVehicleByName(db, new_name)` → 已存在且非自身 → "已存在车辆「new_name」，换个名字"（AC-A3）。
3. `renameVehicle(db, v.id, new_name)` → "✅ 已将「name」改名为「new_name」"。

> 历史记录关联 `vehicle_id`，显示名来自 `vehicles` 表（resolveVehicle / JOIN），故改名自动作用于过去所有记录（AC-A2），无需动记录表。

### Prompt
增："改车名用 rename_vehicle（'把小绿改名叫大绿'→name=小绿, new_name=大绿）。"

## B. 纯文本输出

### 方案
双层防御：
1. **Prompt 约束**（减少产生）：系统提示要求"纯文本回复，不要用 Markdown（不要 \*\* \* \` # 等），用 emoji 和换行排版"。
2. **输出清洗**（兜底）：新增 `src/format.ts` 的 `toPlainText(s)`，在 `session.ts` 回复前对最终文本清洗。

### `toPlainText` 规则（保守，不破坏工具输出）
| 输入 | 输出 |
|------|------|
| ` ```lang\n…``` ` | 去围栏，留内容 |
| `` `code` `` | `code` |
| `**bold**` / `*italic*` | `bold` / `italic` |
| `### 标题`（行首） | `标题` |
| `[文字](url)` | `文字` |
| 行首 `- 项` / `* 项` | `• 项` |

**安全性**（AC-B4）：工具输出用的 `─`（U+2500，非 `-`）、`•`、`¥`、`日期 2026-06-01`（`-` 不在行首）均不被规则命中；`**`/`` ` ``/`#` 在工具输出中不存在，清洗对其为无操作。

### 应用点
`session.ts` `runAgent`：`reply = toPlainText(reply)` 后再 `ctx.reply(reply)`。`/start`、`/help` 静态文案已是纯文本，不经此路径，无需处理。

## 测试要点
- `test/format.test.ts`：`toPlainText` 各规则 + 工具样例输出"穿过不变"（含 `─` 线、`•`、`¥`、日期）。
- 改名：`test/vehicles.test.ts` 增 AC-A1/A3/A4；改名后 `query_stats` 表头显示新名（AC-A2）。
- 回归：既有 111 测试不受影响。
