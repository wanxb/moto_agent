export interface Env {
  DB: D1Database;
  SESSION_KV: KVNamespace;
  // Cloudflare Workers AI 绑定（spec 008 语音转文字）。最小接口，与 workers-types 的逐模型 schema 解耦。
  AI: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  DEEPSEEK_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  ALLOWED_CHAT_ID: string;
  DASHBOARD_URL?: string;   // Dashboard / PWA 域名；也是 Magic Link 链接域名
  KNOWLEDGE_INDEX: VectorizeIndex;  // spec 015 知识库 RAG
  RESEND_API_KEY?: string;  // spec 016 发信（Resend），经 wrangler secret put 注入
  SENDER_EMAIL?: string;    // spec 016 发件地址，须属于 Resend 已验证域名
}

// OpenAI-compatible message format (used internally and for DeepSeek)
export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMResponse {
  textContent: string | null;
  toolCalls: ResolvedToolCall[] | null;
  // Raw assistant message to push into history
  assistantMessage: Message;
}

export interface ResolvedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// 用户（spec 016 多用户）。email / telegram_id 任一可空。
export interface User {
  id: number;
  email: string | null;
  telegram_id: string | null;
  nickname: string | null;
  lang: 'zh' | 'en';
  is_admin: number;                   // 0 | 1
  status: 'active' | 'merged';        // merged=账号合并后失活
  created_at: string;
  last_login: string | null;
}

export interface FuelRecord {
  id: number;
  date: string;
  odometer: number;
  liters: number;
  price_total: number;
  fuel_type: string;
  note: string | null;
  vehicle_id: number | null;
  deleted_at: string | null;
  user_id: number | null;             // 所属用户（spec 016）
  created_at: string;
}

export interface Vehicle {
  id: number;
  name: string;
  alias: string | null;  // 简称/别名（spec 009）
  brand: string | null;           // 品牌（spec 011）
  model: string | null;           // 型号（spec 011）
  fuel_type: string | null;       // 默认油号（spec 011）
  tank_capacity: number | null;   // 油箱容量 L（spec 011）
  color: string | null;           // 颜色（spec 011）
  is_default: number;   // 0 | 1
  is_active: number;    // 0 | 1
  user_id: number | null;
  created_at: string;
}

export interface MaintenanceRecord {
  id: number;
  date: string;
  type: string;
  odometer: number | null;
  cost: number | null;
  note: string | null;
  vehicle_id: number | null;
  deleted_at: string | null;   // 软删除时刻（spec 017，null=活跃）
  user_id: number | null;      // 所属用户（spec 016）
  created_at: string;
}

export interface Reminder {
  id: number;
  vehicle_id: number | null;
  type: string;
  mode: 'mileage' | 'date';
  trigger_odometer: number | null;
  trigger_date: string | null;
  interval_km: number | null;
  note: string | null;
  chat_id: string | null;
  user_id: number | null;      // 所属用户（spec 016）；与 chat_id 解耦
  status: 'active' | 'done';
  fired_at: string | null;
  created_at: string;
}

// getActiveReminders 的 LEFT JOIN 结果，附带车辆名
export interface ReminderWithVehicle extends Reminder {
  vehicle_name: string | null;
}

// ── 知识库 RAG（spec 015）───────────────────────────────────────────────────────

export interface KnowledgeChunk {
  id: number;
  chunk_text: string;
  source_doc: string;
  section_title: string | null;
  chunk_index: number;
  topics: string | null;
  doc_hash: string | null;
  created_at: string;
}
