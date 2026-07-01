# 设计：图片上传与多模态分析

> 规格 020 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md)
> 约束来源：[architecture](../../engineering/architecture.md) · [agent-design](../../engineering/agent-design.md) · [data-model](../../engineering/data-model.md) · [security](../../engineering/security.md)

## 1. 方案概述

**核心思路：不新增工具，不改 Agent Loop，以最小的基础设施改动让 LLM 直接"看懂"图片。**

图片消息走与语音（spec 008）相同的"下载 → 编码 → 注入 Pipeline"模式。不同之处在于：
- 语音：转文字后仍为纯文本消息
- 图片：以 `ContentBlock[]`（OpenAI 多模态格式）替换原有 `string content` 传入 LLM

系统自动检测消息中是否含图片，将对话路由到 Claude（多模态支持确认），DeepSeek 只处理纯文本。图片用 base64 编码、纯内存处理、不持久化。

```
Telegram 图片 → 下载 → base64 → ContentBlock → VisionAwareLLM → Claude → tools(不变)
                                ↑             ↑
                            Pipeline 适配   自动分发，对 agent.ts 透明
```

### 为什么不新增工具

因为 LLM 视觉可以直接理解图片内容，用**已有工具**完成后续动作：
- 看到里程表 → 调 `log_mileage`（已有）
- 看到加油小票 → 调 `log_fuel`（已有）
- 看到故障灯 → 调 `search_knowledge`（已有）+ `log_mileage`
- 看到摩托车 + 保养问题 → 调 `search_knowledge`

**零新增工具，零改动 Agent Loop。**

## 2. 数据模型变更

> 遵守"只增不删"（[data-model](../../engineering/data-model.md) §5）。

**本期无数据模型变更。** 图片不持久化到 D1/R2。

未来的 v2 如需持久化图片（记录历史查看、车型参考照），再加 `images` 表和 R2 绑定，但 v1 不做。

## 3. 类型变更

### `src/types.ts` — 新增 `ContentBlock` 类型

```typescript
// 多模态内容块（OpenAI 兼容格式）
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };  // URL 或 data:base64 URI

// Message 扩展：user 消息 content 可接受 ContentBlock[]
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentBlock[] }  // ← 改这一行
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };
```

## 4. 基础设施变更

### `VisionAwareLLM` — 新增 LLM 分发层

`src/infra/vision-aware-llm.ts`，实现 `ILLMProvider` 接口：

```typescript
class VisionAwareLLM implements ILLMProvider {
  constructor(
    private defaultLLM: ILLMProvider,  // RouterLLM（DeepSeek Flash/Pro）
    private visionLLM: ILLMProvider,   // Anthropic（Claude Sonnet）
  ) {}

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const hasImage = messages.some(m =>
      m.role === 'user' && Array.isArray(m.content) &&
      m.content.some(c => c.type === 'image_url')
    );
    // 有图片 → 全部走 Claude（包括后续工具轮次）
    if (hasImage) return this.visionLLM.chat(messages, tools);
    return this.defaultLLM.chat(messages, tools);
  }
}
```

在 `bootstrap.ts` 中包装现有 LLM 链：

```typescript
const llm = new VisionAwareLLM(
  new RouterLLM(simpleTier, complexTier),  // 默认文本 LLM
  new AnthropicLLM(env.ANTHROPIC_API_KEY),  // 视觉专用 Claude
);
```

### `src/llm-transport.ts` — 两个 provider 适配图片

**DeepSeek（OpenAI 兼容）**：无需改动。消息中的 `ContentBlock[]` 按 OpenAI 多模态格式直接序列化发给 DeepSeek。如果 DeepSeek 不支持图片，API 会返回错误 → `FallbackLLM` 自动重试 → 最终 fallback 到其他 provider。但有了 `VisionAwareLLM` 分发层，DeepSeek 实际不会收到含图片的消息。

**Anthropic（toAnthropicMessages）**：需改造 `toAnthropicMessages()`，使其在 `msg.role === 'user'` 时检测 `content` 类型：

```
当前: content: [{ type: 'text', text: msg.content }]       // 只处理字符串
改成: 如果 msg.content 是数组 → 逐 block 转换
        text block → { type: 'text', text }
        image_url block → { type: 'image', source: { type: 'base64', media_type, data } }
      否则 → 原逻辑（字符串 → 单 text block）
```

### 图片下载与编码工具函数

`src/stt.ts` 已有 `toBase64()`，可直接复用。新增一个 `src/image.ts` 模块：

```typescript
// src/image.ts
/** 从 Telegram 下载图片 → base64 data URI */
export async function downloadTelegramPhoto(
  fileId: string, botToken: string
): Promise<{ dataUri: string; mediaType: string }>;

/** 从 Request form-data 提取图片 */
export async function extractImageFromForm(request: Request): Promise<{ dataUri: string; text: string } | null>;
```

Pipeline 不直接调这些函数——适配器层在 `extractText` 之外新增 `extractImage` 概念。

## 5. 渠道适配器变更

### `ChannelAdapter` 接口（`src/ports.ts`）

新增可选方法 `extractImage`：

```typescript
export interface ChannelAdapter {
  extractUser(raw: unknown): string;
  extractText(raw: unknown): Promise<string>;
  // 新增：可选，返回图片 content blocks（含 base64 data URI）
  extractImage?(raw: unknown): Promise<ContentBlock[] | null>;
  reply(userId: string, text: string): Promise<unknown>;
  // 其余方法不变...
}
```

### Telegram 适配器（`src/gateway/adapters/telegram.ts`）

实现 `extractImage`：

```typescript
async extractImage(raw: unknown): Promise<ContentBlock[] | null> {
  // 从 raw 中提取 photo 信息（由 bot.on('message:photo') 传入）
  const { photo, caption } = raw as { photo?: PhotoSize[]; caption?: string };
  if (!photo?.length) return null;
  
  // 选中等分辨率（避开原图减少传输量）
  const target = photo[Math.min(photo.length - 1, 2)];
  const file = await this.ctx.api.getFile(target.file_id);
  if (!file.file_path) return null;
  const url = `https://api.telegram.org/file/bot${this.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const base64 = toBase64(bytes);
  
  const blocks: ContentBlock[] = [];
  if (caption?.trim()) blocks.push({ type: 'text', text: caption });
  blocks.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } });
  return blocks;
}
```

### REST 适配器（`src/gateway/adapters/rest.ts`）

实现 `extractImage`——从 multipart form-data 中提取上传的图片文件。

## 6. Pipeline 变更（`src/gateway/pipeline.ts`）

关键改动：

1. **步骤 4 不再因空 text 提前 return**——改为先调 `extractImage`，有图片则继续
2. **构建 `user` 消息时**，如果有图片内容块则用 `ContentBlock[]` 而非字符串

```typescript
// 原：if (!text) { await adapter.reply(...); return null; }
// 改为：
const imageBlocks = adapter.extractImage ? await adapter.extractImage(raw) : null;
if (!text && !imageBlocks) {
  await adapter.reply(userId, t('general.no_image_text', lang));
  return null;
}

// 构建用户消息
const userContent: string | ContentBlock[] = imageBlocks
  ? [...(imageBlocks.some(b => b.type === 'text') ? [] : text ? [{ type: 'text' as const, text }] : []), ...imageBlocks]
  : text;
history.push({ role: 'user', content: userContent });
```

## 7. Telegram 入口（`src/index.ts`）

新增 `message:photo` 处理器，与现有 voice handler 模式一致：

```typescript
bot.on('message:photo', async ctx => {
  const app = bootstrap(env);
  const adapter = new TelegramAdapter(ctx, env);
  // photo + caption 打包进 raw，适配器 extractImage 从中提取
  const photo = ctx.message!.photo;
  const caption = ctx.message!.caption ?? '';
  await app.run(adapter, { photo, caption, type: 'photo' });
});
```

## 8. PWA Web 端（`src/routes/chat-api.ts`）

新增 `POST /chat/image` 端点：

```
POST /chat/image
Content-Type: multipart/form-data
Fields: image (file), text (string optional)

→ 返回 { reply: string }
```

流程：
1. 解析 form-data 提取图片文件 + 可选文字
2. 读取文件 bytes → base64 → `ContentBlock[]`
3. 走 `runChat` 逻辑——与文字/语音相同的 Agent Loop
4. 区别：消息用 `ContentBlock[]` 构建而非纯字符串

## 9. 系统提示（`src/prompts.ts`）

新增规则——保持精简，中英文各一句：

**中文**（末尾追加）：
```
20. 当用户发来图片时，仔细看图片内容：
    - 仪表盘：提取里程数字，有故障灯则查知识库
    - 加油机/小票：提取油号、单价、升数、金额
    - 摩托车照片：结合用户问题查知识库
    不确定图片中的车辆时问用户，别猜。和摩托车无关的图，礼貌说明。
```

**英文**（末尾追加）：
```
20. When a user sends an image, carefully analyze it:
    - Dashboard: extract odometer reading; if warning lights are on, search the knowledge base
    - Fuel pump/receipt: extract fuel grade, unit price, liters, total amount
    - Motorcycle photo: combine with user's question, search the knowledge base
    If you can't identify the vehicle from the image, ask the user — don't guess.
    If the image is unrelated to motorcycles, politely explain your scope.
```

## 10. 流程 / 时序

### Telegram 发图 → LLM 分析 → 工具调用

```
用户: [图片] + "帮我记一下"
       ↓
grammY bot.on('message:photo')
       ↓
TelegramAdapter.extractImage()
  ├─ ctx.getFile() → 下载 bytes
  └─ base64 → ContentBlock[{image_url}]
       ↓
Pipeline.run
  ├─ extractText (caption / 空字符串)
  ├─ extractImage → ContentBlock[]
  ├─ history.push({ role: 'user', content: ContentBlock[] })
  └─ ctx.agent(history, ...)
       ↓
runAgentLoop (不变)
  └─ Round 1: llm.chat(working, tools)
       └─ VisionAwareLLM 检测到图片 → 路由到 Claude
       ↓
  Claude 分析图片:
    ├─ 看到仪表盘里程 15234
    └─ 看到故障灯亮
       ↓
  Round 2: Claude 调 search_knowledge("故障灯")
  Round 3: Claude 调 log_mileage(odometer=15234)
  Round 4: Claude 合成回答
       ↓
用户: 看到回复含里程记录 + 故障灯诊断
```

### 关键路径：VisionAwareLLM 分发

```
llm.chat(working, tools)
  └─ hasImage()? ──是──→ AnthropicLLM.chat()
      否                    ├─ toAnthropicMessages(含图片 blocks)
       └─→ RouterLLM.chat()  └─ 调 Claude API
             ├─ 简单 → Flash        ← 图片块 → { type: 'image', source: { base64 } }
             └─ 复杂 → Pro           ← 文本块 → { type: 'text' }
```

## 11. i18n 变更

`src/i18n/zh.ts` + `en.ts` 新增键：

```typescript
// zh.ts（80-90区段）
'image.processing': '📸 正在分析图片…',
'image.not_motorcycle': '🐱 这张照片看起来不是摩托车相关的。我只能处理摩托车相关图片——仪表盘、加油记录、维修保养等。有其他摩托车问题随时问我！',
'image.vehicle_unclear': '从照片看不太出是哪辆车，请告诉我这辆车叫什么名字？',

// en.ts
'image.processing': '📸 Analyzing image…',
'image.not_motorcycle': '🐱 This photo doesn\'t look motorcycle-related. I can handle motorcycle photos — dashboards, fuel receipts, maintenance questions, etc. Ask me anything about your bike!',
'image.vehicle_unclear': 'I can\'t tell which motorcycle this is from the photo. What\'s the name of this bike?',
```

## 12. 边界与错误处理

- **下载失败**（Telegram API 不可用）：回复图片处理失败，让用户重试或打字
- **图片过大**（base64 > 15MB）：尝试选更低分辨率 PhotoSize；最低分辨率仍超限则回复"图片太大，请压缩后重试"
- **图片格式不支持**：Telegram 只发 JPEG/PNG/WebP/GIF，都支持；PWA 上传同理
- **LLM 视觉分析失败**（API error / timeout）：回退到文字提取（如有 caption），或回复"图片分析失败，请描述一下图片内容"
- **无 caption 也无文字**：图片本身有内容（如里程表），LLM 只看图也能处理。但如 LLM 也需要文字提示（如"帮我记录"），就靠图片内容推断用户意图
- **Session 不存图片**：KV 值可能超过 1MB 限制，且无必要。LLM 的文本回复已包含分析结果，后续追问靠文本上下文
- **多轮含图**：第一轮发图 → LLM 分析 → 工具调用 → 最终回复。图片只出现在第一轮 `working` 消息中。如果用户追问，LLM 从自己的历史回复中回忆

## 13. 风险与权衡

| 风险 | 缓解 |
|------|------|
| Claude API 费用增加（图片 token 远多于文本） | 仅在用户主动发图时走 Claude，文本对话仍走 DeepSeek（免费/低价）；图片 token 消耗约 1k-10k tokens/张，属于可接受范围 |
| DeepSeek 可能支持多模态（设计就过时了） | `VisionAwareLLM` 分发层可轻松修改：只需移除分发逻辑，直接让 DeepSeek 处理图片 block——不影响其他代码 |
| 图片质量太低导致 LLM 误读里程/数字 | Telegram 的 PhotoSize 最低档也有 ~320px 宽，足够 OCR 级别识别；用户对模糊图可重拍 |
| Workers wall-time 30s 不够（下载 + 编码 + LLM 多轮） | 图片处理增加约 2-5s（下载 1s + 编码 0.5s + LLM 视觉响应 1-3s），仍在 30s 内 |
| 用户隐私——图片经 Telegram 和 Anthropic API | 图片纯内存处理不落盘；Anthropic 协议含数据不用于训练的承诺；方案与语音同级别（spec 008 已有类似隐私评估） |
| KV 会话历史无图，追问上下文可能不足 | LLM 在首轮回复中已用文字描述了图片内容，后续轮次依赖该文字；极端情况 LLM 可能细节模糊，用户可再发一次图 |

## 14. 测试要点

- `VisionAwareLLM` 分发逻辑：含图片消息 → 路由到 vision provider；无图片 → 路由到默认 provider
- `toAnthropicMessages` 图片 block 转换：`image_url` → Anthropic `image` block；base64 data URI 解析正确；media_type 提取正确
- `TelegramAdapter.extractImage`：从 mock `raw` 提取 photo 并生成 `ContentBlock[]`；无图片时返回 null
- Pipeline 图片流程：`extractImage` 返回 blocks → 构建正确的 `user` 消息 → Agent Loop 收到含图内容
- `message:photo` handler：正确的 grammY 事件绑定 + raw 结构
- I18n：新增 key 中英文翻译正确
- 回归：现有 287 个测试全绿；所有文本对话行为完全不变

## 15. 新增/修改文件清单

### 新增文件

| 文件 | 职责 | 预计行数 |
|------|------|---------|
| `src/infra/vision-aware-llm.ts` | `VisionAwareLLM` 分发层 | ~30 |
| `src/image.ts` | 图片下载、编码工具函数 | ~40 |
| `test/image.test.ts` | 图片相关测试 | ~100 |

### 修改文件

| 文件 | 改动 | 预计行数 |
|------|------|---------|
| `src/types.ts` | 新增 `ContentBlock` 类型；扩展 `Message` | ~8 |
| `src/ports.ts` | `ChannelAdapter` 加 `extractImage?` 可选方法 | ~4 |
| `src/llm-transport.ts` | `toAnthropicMessages` 支持图片 content blocks | ~30 |
| `src/bootstrap.ts` | 创建 `VisionAwareLLM` 包裹 `RouterLLM` | ~5 |
| `src/index.ts` | 新增 `bot.on('message:photo', ...)` 处理器 | ~20 |
| `src/gateway/pipeline.ts` | 处理 `extractImage`；构建 `ContentBlock` 消息 | ~20 |
| `src/gateway/adapters/telegram.ts` | 实现 `extractImage` | ~30 |
| `src/gateway/adapters/rest.ts` | 实现 `extractImage` | ~15 |
| `src/routes/chat-api.ts` | 新增 `POST /chat/image` 端点 | ~40 |
| `src/prompts.ts` | 加第 20 条规则（中英各一行） | ~8 |
| `src/i18n/zh.ts` | 新增 `image.*` 翻译键 | ~5 |
| `src/i18n/en.ts` | 新增 `image.*` 翻译键 | ~5 |
| `src/infra/anthropic-llm.ts` | 新增 LLM 适配器（或复用 fallback-llm 方式） | ~30 |

### 无变更文件

`src/agent.ts`、`src/config.ts`、`src/database.ts`、`src/router/`、`src/tools/`（全部）、`docs/schema.sql`、`test/utils.ts`、`test/tools.test.ts`、所有现有测试。
