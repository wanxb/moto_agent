# ADR-0007：语音转文字（STT）用 Cloudflare Workers AI

**状态**：✅ Accepted ·  **日期**：Phase 2（spec 008）

## 背景

[spec 008 语音输入](../../specs/008-voice-input/) 需要把 Telegram 语音（OGG/Opus）转成文字再走现有解析链路。需选一个 STT 方案。约束：中文好、成本低、契合 Cloudflare 生态、Workers 运行时可用（无 ffmpeg、无本地大模型）。

## 决策

**用 Cloudflare Workers AI 的 Whisper（`@cf/openai/whisper-large-v3-turbo`）**，通过 `[ai]` binding 在 Worker 内直接转写；STT 封装为 `src/stt.ts` 的 `transcribe()` 接口，便于将来替换。

## 理由 / 后果

**正面**：
- **留在 Cloudflare 生态**（合 [ADR-0002](0002-cloudflare-workers-runtime.md) 演进原则）：无新厂商、无新 API key，只加一个 binding。
- **隐私更好**：音频不出 Cloudflare（对比发给 OpenAI/Groq）。
- 同边缘、低延迟；Whisper 直接吃 OGG/Opus 字节，**无需 ffmpeg 转码**（Workers 本就跑不了 ffmpeg）。
- Workers AI 有每日免费 Neurons 额度，个人量级基本零成本。

**负面 / 代价**：
- 中文精度可能略逊于 OpenAI 最新模型（whisper-large-v3 系一般够用）。
- 受 Workers AI 配额/可用性约束；账户需启用 Workers AI（默认可用）。

## 可替换性

`transcribe(bytes, env)` 是单一接口（仿 `callLLM()` 主备模式）。若实测中文精度不满意，改 `stt.ts` 一处即可切到 OpenAI Whisper / Groq（OpenAI 兼容），上层 voice handler 不变。

## 备选方案

- **OpenAI Whisper / gpt-4o-mini-transcribe**：中文最佳、成熟，但引入新厂商+key、音频外发。否决（生态/隐私），保留为可切换备选。
- **Groq Whisper**：快且便宜、OpenAI 兼容，但同样外部厂商。否决，保留为备选。
- **DeepSeek**：无 STT 接口，不可用。
- **本地 Whisper / ffmpeg 转码**：Workers 运行时不支持。否决。

## 关联

[spec 008](../../specs/008-voice-input/) · [ADR-0002](0002-cloudflare-workers-runtime.md) · [security.md](../security.md)（第三方数据外发）。
