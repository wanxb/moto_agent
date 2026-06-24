# 设计：语音输入

> 规格 008 · 关联：[requirements.md](requirements.md) · [tasks.md](tasks.md) · [ADR-0007](../../engineering/adr/0007-cloudflare-workers-ai-stt.md)

**无数据库结构变更。** 新增一个入口 + 一个 STT 层；转文字后复用现有 `runAgent` 全链路。

## 1. 链路

```
message:voice → 时长校验 → ctx.getFile() 拿 file_path
  → fetch https://api.telegram.org/file/bot<token>/<file_path> 下载 OGG 字节
  → transcribe(bytes, env)  [Workers AI Whisper]
  → 回显"🎙 听到：text" → runAgent(chatId, text, env, ctx)
```

## 2. STT 层（src/stt.ts）

```ts
const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';
export async function transcribe(bytes: Uint8Array, env: Env): Promise<string> {
  const audio = toBase64(bytes);                      // Whisper-turbo 收 base64
  const res = await env.AI.run(WHISPER_MODEL, { audio, task: 'transcribe', language: 'zh' });
  return ((res as { text?: string }).text ?? '').trim();
}
export function toBase64(bytes: Uint8Array): string   // 分块避免大数组 spread 溢出
```

- 模型常量集中一处，便于按 [ADR-0007](../../engineering/adr/0007-cloudflare-workers-ai-stt.md) 切换。
- `language: 'zh'` 固定中文，提升短音频识别稳定性。
- 结果为空 → 返回空串，由 handler 给"没听清"。

## 3. 入口（src/index.ts）

`bot.on('message:voice', ...)`（在访问控制中间件之后，自动受白名单保护）：
- `MAX_VOICE_SECONDS = 60`：`voice.duration` 超限 → 提示，**不调 STT**（AC5）。
- 下载 + 转写包在 try/catch：异常 → "语音识别失败，请再说一遍或直接打字"（AC4），`console.error('[voice] ...')`。
- 空文本 → "没听清…"（AC3）。
- 成功 → `ctx.reply('🎙 听到：' + text)` 回显（用户选择），再 `runAgent(chatId, text, env, ctx)`（AC1/AC2）。
- `[voice] duration=.. chars=..` 埋点（对齐 spec 006 风格）。

## 4. 配置

- `wrangler.toml` 增 `[ai]\nbinding = "AI"`。
- `types.ts` `Env` 增 `AI`（最小接口 `{ run(model, inputs): Promise<unknown> }`，与 workers-types 的模型 schema 解耦，避免类型摩擦）。
- 无新 secret（Workers AI 用 binding 鉴权，非 key）。

## 5. 复用与解耦

- 工具/Agent/数据层**零改动**：语音只是把"文本来源"从打字换成转写。
- 所有现有能力（多车/维保/提醒/纠错/改名）语音自动可用（AC2）。
- 纠错闭环：识别错→回显可见→`update_last_fuel`（spec 004）改（AC6）。

## 6. 边界与错误处理

| 情况 | 处理 |
|------|------|
| 时长超限 | 提示，不调 STT |
| 下载/转写异常 | catch → 提示打字 + 日志 |
| 空识别 | "没听清" |
| `file_path` 缺失 | 视为失败兜底 |

## 7. 风险与权衡

| 风险 | 缓解 |
|------|------|
| 中文/数字识别误差 | 回显可见 + LLM 容错 + 纠错闭环；可切 OpenAI（ADR-0007） |
| Workers AI 配额/延迟 | 失败兜底打字；`[voice]` 日志监控 |
| 音频较大 base64 内存 | 加油语音短；分块 base64；时长上限兜底 |

## 8. 测试要点
- `test/stt.test.ts`：`toBase64` 正确（mock 已知字节）；`transcribe` 用 mock `env.AI.run` 验证模型名/参数与返回 text、空串处理。
- voice handler 端到端依赖 Telegram + 真实 AI，留**部署后语音冒烟**人工验证（AC1–AC5）。
- 回归：现有 131 测试不受影响（仅新增入口与模块）。
