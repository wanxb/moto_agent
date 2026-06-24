// 集中配置 — 项目中所有可调参数的单一起源。
// 运行时密钥/绑定见 types.ts (Env)；数据库表见 docs/schema.sql。

// ── Agent Loop ───────────────────────────────────────────────────────────────
/** Agent 最多工具调用轮数（Workers wall-time 护栏） */
export const MAX_ROUNDS = 4;

// ── LLM ──────────────────────────────────────────────────────────────────────
/** 主模型 ID（OpenAI 兼容格式，DeepSeek） */
export const DEEPSEEK_MODEL = 'deepseek-chat';
/** 备用模型 ID（Anthropic Messages 格式） */
export const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
/** LLM 回复最大 token 数 */
export const MAX_TOKENS = 2048;

// ── STT ──────────────────────────────────────────────────────────────────────
/** Workers AI Whisper 模型 ID */
export const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo';

// ── 语音输入 ─────────────────────────────────────────────────────────────────
/** 语音消息最长秒数（超过直接拒绝，不调 STT） */
export const MAX_VOICE_SECONDS = 60;

// ── 会话 ─────────────────────────────────────────────────────────────────────
/** KV 会话 TTL（秒） */
export const SESSION_TTL = 3600;
/** 会话历史最大保留消息条数（按回合对齐截断） */
export const MAX_SESSION_MESSAGES = 10;

// ── 限流 ─────────────────────────────────────────────────────────────────────
/** 每用户 60s 最多对话请求数 */
export const RATE_LIMIT_PER_USER = 10;
/** 全局 60s 最多请求数（兜底） */
export const RATE_LIMIT_GLOBAL = 100;
/** 鉴权端点 5min 最多尝试数（防暴力） */
export const RATE_LIMIT_AUTH = 5;

// ── 数据库 ───────────────────────────────────────────────────────────────────
/** fuel_records 可 UPDATE 的列白名单（防注入） */
export const FUEL_EDITABLE_COLUMNS = ['date', 'odometer', 'liters', 'price_total', 'fuel_type', 'note'] as const;
