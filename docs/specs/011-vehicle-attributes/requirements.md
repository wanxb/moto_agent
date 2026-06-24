# Spec 011 — 车辆属性扩展 需求文档

| 字段 | 内容 |
|------|------|
| **Spec 编号** | 011 |
| **状态** | ✔️ Done |
| **Phase** | Phase 2 功能扩展 |
| **优先级** | P2 |
| **设计文档** | [design.md](design.md) |
| **任务列表** | [tasks.md](tasks.md) |
| **依赖** | Spec 001（多车管理）、Spec 009（车辆别名） |

---

## 1. 问题陈述

当前 `vehicles` 表仅有 `name`、`alias`、`is_default` 等基础字段，车辆信息不完整。用户在日常使用中需要记录更丰富的车辆属性，并在加油时利用这些属性简化输入：

- 不知道该车的品牌/型号/颜色等基本信息，Bot 无法回答"我的车油箱多大"之类的问题
- 每次加油都要说油号，即使该车长期加同一种油
- 如果实际加油油号变了（如从 92 换 95），车辆属性不会自动更新

## 2. User Story

### US1 — 录入车辆详细信息
> 作为车主，我希望在添加车辆时能同时录入品牌、型号、默认油号、油箱容量、颜色，以便 Bot 了解我的车的完整信息。

### US2 — 加油默认使用车辆油号
> 作为车主，当我的车长期加同一种油时，我希望记录加油时不用每次都重复说油号，系统应自动使用车辆属性中的默认油号。

### US3 — 油号随使用习惯自动更新
> 作为车主，当我开始持续加另一种油号时，希望系统自动更新车辆的默认油号，无需手动修改。

### US4 — 查看和编辑车辆属性
> 作为车主，我希望随时修改车辆的品牌、型号、油号、油箱容量、颜色等属性，保持信息准确。

## 3. Acceptance Criteria

### AC1 — add_vehicle 支持新属性
**Given** 系统中尚无车辆
**When** 用户说"添加车，本田 CBF190，白色，加 95，油箱 12L"
**Then** 车辆创建成功，brand=本田, model=CBF190, color=白色, fuel_type=95, tank_capacity=12

### AC2 — 不传新属性时车辆正常创建
**Given** 系统中尚无车辆
**When** 用户说"添加一辆车叫小绿"
**Then** 车辆创建成功，brand/model/fuel_type/tank_capacity/color 均为 null

### AC3 — 加油不说油号时用车辆默认值
**Given** 车辆"小绿" fuel_type=95
**When** 用户说"加了 10 升，里程 12000，花了 98"
**Then** 加油记录 fuel_type=95（来自车辆默认值）

### AC4 — 加油说了油号时以用户说的为准
**Given** 车辆"小绿" fuel_type=95
**When** 用户说"加了 10 升 92 号，里程 12000"
**Then** 加油记录 fuel_type=92（用户明确说的优先）

### AC5 — 车辆无默认油号时使用系统默认
**Given** 车辆"小绿" fuel_type=null
**When** 用户说"加了 10 升，里程 12000"（未说油号）
**Then** 加油记录 fuel_type=95（回退到系统默认值）

### AC6 — 油号自动更新（阈值触发）
**Given** 车辆"小绿" fuel_type=92，最近 5 条加油记录中有 ≥3 条用了 95
**When** 用户记录一次加油（第 3 次用 95）
**Then** 车辆 fuel_type 自动更新为 95，记录日志但不额外通知用户

### AC7 — 油号自动更新（未达阈值不触发）
**Given** 车辆"小绿" fuel_type=92，最近 5 条加油记录中只有 2 条用了 95
**When** 用户记录一次加油
**Then** 车辆 fuel_type 保持 92 不变

### AC8 — update_vehicle 修改车辆属性
**Given** 车辆"小绿" 已有 brand=CBF190
**When** 用户说"把小绿的型号改成 CBF190X，颜色改成红色"
**Then** 车辆 model=CBF190X, color=红色，brand 不变

### AC9 — update_vehicle 清空属性
**Given** 车辆"小绿" color=白色
**When** 用户说"小绿的颜色删掉"（或传空字符串）
**Then** 车辆 color=null

### AC10 — update_vehicle 定位方式复用 alias
**Given** 车辆 name=小绿, alias=通勤车
**When** 用户说"通勤车的油箱容量改成 14L"
**Then** 车辆 tank_capacity=14

## 4. Scope

### In Scope
- vehicles 表新增 5 个可空字段：brand, model, fuel_type, tank_capacity, color
- add_vehicle 支持传入新属性
- 新增 update_vehicle 工具，允许修改以上属性
- log_fuel 默认油号逻辑：车辆油号 → system default '95'
- log_fuel 后自动检测油号变化并静默更新车辆属性
- Dashboard `/api/v1/vehicles` 返回新属性

### Out of Scope
- Dashboard 前端展示新属性（后续迭代）
- 油箱容量用于剩余里程推算（后续迭代）
- 品牌/型号约束或枚举（自由文本）
- 多用户数据隔离（Phase 3）
