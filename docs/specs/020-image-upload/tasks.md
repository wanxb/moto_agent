# 任务：图片上传与多模态分析

> 规格 020 · 关联：[requirements.md](requirements.md) · [design.md](design.md)
> 完成标准：[definition-of-done](../../process/definition-of-done.md)。每条任务可独立验证。

## 任务清单

> 顺序：类型 → 基础设施 → 传输层 → 入口 → 渠道 → 提示 → i18n → 测试 → 文档。每条勾选前确认其验证项通过。

### 基础设施

- [ ] **T1 新增 `ContentBlock` 类型并扩展 `Message`**
  - 在 `src/types.ts` 新增 `ContentBlock` union type
  - 将 `Message` 中 `{ role: 'user'; content: string }` 改为 `{ role: 'user'; content: string | ContentBlock[] }`
  - 验证：`npm run type-check` 通过，未有未处理的类型错误

- [ ] **T2 实现 `VisionAwareLLM` 分发层**
  - 新建 `src/infra/vision-aware-llm.ts`，实现 `ILLMProvider` 接口
  - 检测 `messages` 中是否有含 `image_url` content blocks 的 user 消息
  - 有图片 → 路由到 visionLLM（Anthropic）；无图片 → 路由到 defaultLLM（RouterLLM）
  - 在 `src/bootstrap.ts` 中创建 `VisionAwareLLM` 包裹现有 `RouterLLM`
  - 验证：单元测试确认含图消息路由到 vision provider，无图消息路由到默认 provider

- [ ] **T3 新增 Anthropic LLM 适配器（`AnthropicLLM` 类）**
  - 新建 `src/infra/anthropic-llm.ts`，实现 `ILLMProvider` 接口
  - 包装 `callAnthropic()` 函数，注入 API key
  - 验证：可被 `VisionAwareLLM` 作为 vision provider 调用

- [ ] **T4 图片下载与编码工具函数**
  - 新建 `src/image.ts`
  - `downloadTelegramPhoto(fileId, botToken)`：调 Telegram API 下载 → bytes → base64 data URI
  - 从 `PhotoSize[]` 中选择合适分辨率的策略函数
  - 验证：单元测试 mock fetch 返回图片 bytes → data URI 格式正确

### 传输层

- [ ] **T5 `toAnthropicMessages` 支持图片 content blocks**
  - 在 `src/llm-transport.ts` 修改 `toAnthropicMessages()` 中 `role === 'user'` 分支
  - 当 `msg.content` 是数组时逐 block 转换：
    - `{ type: 'text' }` → `{ type: 'text', text }`
    - `{ type: 'image_url' }` 且 url 以 `data:` 开头 → 解析 media_type + base64 data → `{ type: 'image', source: { type: 'base64', media_type, data } }`
  - 当 `msg.content` 仍为字符串时保持原有逻辑
  - 验证：单元测试各种 ContentBlock 组合的转换正确性

### 渠道入口 — Telegram

- [ ] **T6 Telegram `message:photo` 处理器**
  - 在 `src/index.ts` 新增 `bot.on('message:photo', async ctx => { ... })`
  - 从 `ctx.message!.photo` 取 `PhotoSize[]`，从 `ctx.message!.caption` 取可选文字
  - 调用 `app.run(adapter, { photo, caption, type: 'photo' })`
  - 验证：发送图片到测试 bot 触发此处理器（手动）

- [ ] **T7 Telegram 适配器 `extractImage` 实现**
  - 在 `src/gateway/adapters/telegram.ts` 实现 `extractImage(raw)` 方法
  - 从 `raw.photo` 取 PhotoSize（选中等分辨率），`ctx.getFile()` → 下载 → `toBase64()` → data URI
  - 如有 `caption` 则作为 text block 放在首位
  - 返回 `ContentBlock[]`；无图片时返回 `null`
  - 验证：单元测试 mock raw → 返回正确 ContentBlock 数组

### 渠道入口 — PWA

- [ ] **T8 PWA 图片上传端点 `POST /chat/image`**
  - 在 `src/routes/chat-api.ts` 新增端点
  - 解析 `multipart/form-data`，提取 `image` 文件 + `text` 字段
  - 文件 bytes → base64 → `ContentBlock[]`
  - 走 `runChat` 逻辑（复用文字对话的 Agent 调用）
  - 验证：curl 测试上传图片 → 返回 agent 回复

- [ ] **T9 REST 适配器 `extractImage` 实现**
  - 在 `src/gateway/adapters/rest.ts` 实现 `extractImage(raw)` 方法
  - 从 multipart form-data 提取图片文件
  - 返回 `ContentBlock[]`；无图片时返回 `null`
  - 验证：单元测试

### ChannelAdapter 接口

- [ ] **T10 `ChannelAdapter` 接口增加 `extractImage?`**
  - 在 `src/ports.ts` 的 `ChannelAdapter` 接口中新增可选方法
  - 验证：`npm run type-check` 通过

### Pipeline

- [ ] **T11 Pipeline 支持图片消息**
  - 在 `src/gateway/pipeline.ts` 的 `runPipeline` 中：
    - 步骤 4 从`if (!text) return` 改为 `if (!text && !imageBlocks) return`
    - 调 `adapter.extractImage(raw)` 获取图片 blocks
    - 构建 `user` 消息：有图片 blocks 时用 `ContentBlock[]` 而非纯字符串
  - 验证：单元测试确认图片消息正确构建 `ContentBlock[]` user 消息

### 系统提示

- [ ] **T12 `buildSystemPrompt` 增加图片处理规则**
  - 在 `src/prompts.ts` 中英文版末尾各加一条规则（第 20 条）
  - 中文："当用户发来图片时，仔细看图片内容……"
  - 英文："When a user sends an image, carefully analyze it……"
  - 验证：手动检查生成的 system prompt

### i18n

- [ ] **T13 新增图片相关 i18n 键**
  - `src/i18n/zh.ts`：`image.processing`、`image.not_motorcycle`、`image.vehicle_unclear`
  - `src/i18n/en.ts`：同上英文版
  - 验证：`t('image.processing', 'zh')` 返回正确

### 测试

- [ ] **T14 `VisionAwareLLM` 单元测试**
  - 测试含图消息 → 路由到 visionLLM
  - 测试无图消息 → 路由到 defaultLLM
  - 测试有图但 visionLLM 失败 → 错误传播
  - 验证：`npm test` 包含本测试

- [ ] **T15 `toAnthropicMessages` 图片变换测试**
  - 测试 `ContentBlock[]` → Anthropic `content` 数组
  - 测试 data URI 的 media_type 解析
  - 测试空图片数组、混合 text+image、纯 image
  - 测试字符串 content（向后兼容）
  - 验证：`npm test` 包含本测试

- [ ] **T16 Pipeline 图片流程集成测试**
  - mock `TelegramAdapter` 返回图片 blocks + 空 text
  - 验证 Pipeline 不提前 return，user 消息含 ContentBlock
  - 验证：`npm test` 包含本测试

- [ ] **T17 回归测试**
  - 验证：`npm run type-check && npm test` 全绿（287+ 现有测试全部通过）
  - 验证：纯文本对话行为完全不变（无图片时 `VisionAwareLLM` 走 RouterLLM 路径不变）

### 文档

- [ ] **T18 更新影响文档**
  - `docs/specs/README.md` 规格索引加一行 020
  - `CLAUDE.md` §4 代码地图加 `src/image.ts`、`src/infra/vision-aware-llm.ts`
  - `docs/specs/020-image-upload/` 状态标记为 🚧 开发中
  - 验证：文档与代码一致

## 验收（Definition of Done）

- [ ] 所有 `requirements.md` 验收标准（AC1–AC7）满足
- [ ] `npm run type-check && npm test` 全绿
- [ ] 受影响文档已更新（同 PR）
- [ ] 无 secret 泄露，遵守[安全清单](../../engineering/security.md) §7
- [ ] Telegram 手动冒烟：发一张仪表盘图 → 正确响应
