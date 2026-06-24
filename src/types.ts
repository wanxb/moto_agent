export interface Env {
  DB: D1Database;
  SESSION_KV: KVNamespace;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  DEEPSEEK_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  ALLOWED_CHAT_ID: string;
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

export interface FuelRecord {
  id: number;
  date: string;
  odometer: number;
  liters: number;
  price_total: number;
  fuel_type: string;
  note: string | null;
  vehicle_id: number | null;
  created_at: string;
}

export interface Vehicle {
  id: number;
  name: string;
  is_default: number;   // 0 | 1
  is_active: number;    // 0 | 1
  user_id: number | null;
  created_at: string;
}
