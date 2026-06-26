// 集中配置 — 项目中所有可调参数的单一起源。
// 运行时密钥/绑定见 types.ts (Env)；数据库表见 docs/schema.sql。

// ── Agent Loop ───────────────────────────────────────────────────────────────
/** Agent 最多工具调用轮数（Workers wall-time 护栏） */
export const MAX_ROUNDS = 4;

// ── LLM ──────────────────────────────────────────────────────────────────────
/** 主模型 ID（OpenAI 兼容格式，DeepSeek V4 Flash，2026-07-24 起替代 deepseek-chat） */
export const DEEPSEEK_MODEL = 'deepseek-v4-flash';
/** 强推理模型 ID（V4 Pro，用于分层路由等对推理质量要求高的场景） */
export const DEEPSEEK_MODEL_PRO = 'deepseek-v4-pro';
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

// ── 多用户认证（spec 016）─────────────────────────────────────────────────────
/** Magic Link token TTL（秒，15 分钟） */
export const MAGIC_LINK_TTL = 900;
/** 账号绑定验证链接 token TTL（秒，10 分钟） */
export const BIND_LINK_TTL = 600;
/** 登录 Session TTL（秒，30 天） */
export const AUTH_SESSION_TTL = 2592000;
/** Session 滑动续期阈值（秒，7 天）：剩余 TTL 低于此值则续期到满 */
export const SESSION_RENEW_THRESHOLD = 604800;

// ── 数据库 ───────────────────────────────────────────────────────────────────
/** fuel_records 可 UPDATE 的列白名单（防注入） */
export const FUEL_EDITABLE_COLUMNS = ['date', 'odometer', 'liters', 'price_total', 'fuel_type', 'note'] as const;

// ── 去重（spec 017）─────────────────────────────────────────────────────────
/** 加油去重：同车同日里程差 ≤ 此值（km）视为疑似重复，写入前软拦截 */
export const FUEL_DUP_KM_THRESHOLD = 2;
/** 维保去重：同车同类型且日期差 ≤ 此值（天）视为疑似重复，写入前软拦截 */
export const MAINT_DUP_DAYS = 1;
