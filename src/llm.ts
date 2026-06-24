import { Message, ToolCall, ToolDefinition, LLMResponse, ResolvedToolCall } from './types';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEEPSEEK_MODEL = 'deepseek-chat';
const MAX_TOKENS = 2048;

export class LLMError extends Error {
  constructor(public status: number, body: string) { super(`HTTP ${status}: ${body}`); }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function isRetryable(e: unknown): boolean {
  return e instanceof LLMError && (e.status === 429 || e.status >= 500);
}

export async function callLLM(
  messages: Message[],
  tools: ToolDefinition[],
  deepseekKey: string,
  anthropicKey: string
): Promise<LLMResponse> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callDeepSeek(messages, tools, deepseekKey);
    } catch (e) {
      if (!isRetryable(e)) throw e;        // 4xx: 即刻抛出，不 fallback
      if (attempt === 2) break;            // 3次 5xx/429 耗尽 → fallback
      await sleep(500 * Math.pow(2, attempt));
    }
  }
  console.log('[llm] DeepSeek unavailable, falling back to Anthropic');
  return await callAnthropic(messages, tools, anthropicKey);
}

// ── DeepSeek (OpenAI-compatible) ─────────────────────────────────────────────

export async function callDeepSeek(
  messages: Message[], tools: ToolDefinition[], apiKey: string
): Promise<LLMResponse> {
  const body: Record<string, unknown> = {
    model: DEEPSEEK_MODEL,
    messages,
    max_tokens: MAX_TOKENS,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new LLMError(res.status, await res.text());

  const data = await res.json() as { choices: [{ message: { content: string | null; tool_calls?: ToolCall[] } }] };
  const msg = data.choices[0].message;
  const toolCalls = msg.tool_calls?.length ? resolveOAIToolCalls(msg.tool_calls) : null;

  return {
    textContent: msg.content ?? null,
    toolCalls,
    assistantMessage: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls },
  };
}

function resolveOAIToolCalls(calls: ToolCall[]): ResolvedToolCall[] {
  return calls.map(tc => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  }));
}

// ── Anthropic ────────────────────────────────────────────────────────────────

export async function callAnthropic(
  messages: Message[], tools: ToolDefinition[], apiKey: string
): Promise<LLMResponse> {
  const { system, anthropicMessages } = toAnthropicMessages(messages);
  const anthropicTools = tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  const body: Record<string, unknown> = {
    model: ANTHROPIC_MODEL,
    system,
    messages: anthropicMessages,
    max_tokens: MAX_TOKENS,
  };
  if (anthropicTools.length > 0) body.tools = anthropicTools;

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new LLMError(res.status, await res.text());

  const data = await res.json() as { content: AnthropicBlock[] };
  const textContent = data.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text).join('') || null;

  const toolUseBlocks = data.content
    .filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use');

  const oaiToolCalls: ToolCall[] = toolUseBlocks.map(b => ({
    id: b.id, type: 'function',
    function: { name: b.name, arguments: JSON.stringify(b.input) },
  }));

  return {
    textContent,
    toolCalls: oaiToolCalls.length > 0 ? resolveOAIToolCalls(oaiToolCalls) : null,
    assistantMessage: {
      role: 'assistant',
      content: textContent,
      tool_calls: oaiToolCalls.length > 0 ? oaiToolCalls : undefined,
    },
  };
}

// Convert OpenAI-format messages → Anthropic format
function toAnthropicMessages(messages: Message[]): { system: string; anthropicMessages: unknown[] } {
  let system = '';
  const out: unknown[] = [];

  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'system') {
      system = msg.content;
      i++; continue;
    }

    if (msg.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: msg.content }] });
      i++; continue;
    }

    if (msg.role === 'assistant') {
      if (msg.tool_calls?.length) {
        const content: unknown[] = [];
        if (msg.content) content.push({ type: 'text', text: msg.content });
        for (const tc of msg.tool_calls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) });
        }
        out.push({ role: 'assistant', content });
      } else {
        out.push({ role: 'assistant', content: [{ type: 'text', text: msg.content ?? '' }] });
      }
      i++; continue;
    }

    // Collect consecutive tool results into one user message
    if (msg.role === 'tool') {
      const toolResults: unknown[] = [];
      while (i < messages.length && messages[i].role === 'tool') {
        const tm = messages[i] as { role: 'tool'; tool_call_id: string; content: string };
        toolResults.push({ type: 'tool_result', tool_use_id: tm.tool_call_id, content: tm.content });
        i++;
      }
      out.push({ role: 'user', content: toolResults });
      continue;
    }

    i++;
  }

  return { system, anthropicMessages: out };
}

type AnthropicBlock = { type: string };
interface AnthropicToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
