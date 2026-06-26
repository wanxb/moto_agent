// PWA 对话后端（spec 016）：/chat/api（对话 + 历史）+ /chat/voice（语音）。
// 鉴权走 session cookie（resolveSession）；对话历史独立于 Telegram，存 session:pwa:{user_id}（1h）。
// user_id 注入 Agent Loop，数据按用户隔离（复用 bootstrap 的模型栈与工具）。

import type { Env, Message } from '../types';
import type { Lang } from '../i18n/types';
import { bootstrap } from '../bootstrap';
import { resolveSessionFromRequest } from '../services/session';
import { getUserById } from '../database';
import { transcribe } from '../stt';
import { trimHistory } from '../session-store/trim-history';
import { toPlainText } from '../format';
import { MAX_SESSION_MESSAGES } from '../config';

const PWA_HISTORY_TTL = 3600;              // PWA 对话历史 1 小时
const MAX_VOICE_BYTES = 5 * 1024 * 1024;   // 录音上限（30s 语音约 500KB，5MB 足够）

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
function histKey(userId: number): string { return `session:pwa:${userId}`; }

async function getHistory(env: Env, userId: number): Promise<Message[]> {
  const raw = await env.SESSION_KV.get(histKey(userId));
  return raw ? (JSON.parse(raw) as Message[]) : [];
}
async function setHistory(env: Env, userId: number, msgs: Message[]): Promise<void> {
  await env.SESSION_KV.put(histKey(userId), JSON.stringify(msgs), { expirationTtl: PWA_HISTORY_TTL });
}

// 只把 user / 有内容的 assistant 暴露给前端渲染（tool 消息、空 assistant 不显示）。
function forDisplay(msgs: Message[]): { role: string; content: string }[] {
  return msgs
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
    .map(m => ({ role: m.role, content: m.content as string }));
}

async function userLang(env: Env, userId: number): Promise<Lang> {
  const u = await getUserById(env.DB, userId);
  return u?.lang === 'en' ? 'en' : 'zh';
}

/** 跑一轮对话：读历史 → 注入 user_id 调 Agent → 截断持久化 → 返回干净回复文本。 */
async function runChat(env: Env, userId: number, text: string): Promise<string> {
  const app = bootstrap(env);
  const lang = await userLang(env, userId);
  const history = await getHistory(env, userId);
  history.push({ role: 'user', content: text });

  const reply = await app.agent(history, env.DB, lang, userId);
  const clean = toPlainText(reply);

  // runAgentLoop 已把 assistant/tool 轮次 push 进 history；按完整回合截断后持久化
  await setHistory(env, userId, trimHistory(history, MAX_SESSION_MESSAGES));
  return clean;
}

export async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  const session = await resolveSessionFromRequest(request, env.SESSION_KV);
  if (!session) return json(401, { error: 'unauthorized' });
  const userId = session.user_id;

  // GET /chat/api?history=1 —— 拉最近对话历史
  if (url.pathname === '/chat/api' && request.method === 'GET') {
    return json(200, { messages: forDisplay(await getHistory(env, userId)) });
  }

  // POST /chat/api { text } —— 文字对话
  if (url.pathname === '/chat/api' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { text?: string };
    const text = (body.text || '').trim();
    if (!text) return json(400, { error: 'no_text' });
    try {
      return json(200, { reply: await runChat(env, userId, text) });
    } catch (e) {
      console.error('[chat] api error:', e instanceof Error ? e.message : String(e));
      return json(500, { error: 'agent_error' });
    }
  }

  // POST /chat/voice (multipart: audio) —— 语音对话
  if (url.pathname === '/chat/voice' && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    // workers-types 把 get() 标注为 string|null，但运行时上传文件是 File 对象，故经 unknown 收窄。
    const entry = form?.get('audio') as unknown;
    if (!entry || typeof entry === 'string') return json(400, { error: 'no_audio' });
    const file = entry as { size: number; arrayBuffer(): Promise<ArrayBuffer> };
    if (file.size > MAX_VOICE_BYTES) return json(413, { error: 'audio_too_large' });

    const lang = await userLang(env, userId);
    let textIn: string;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      textIn = await transcribe(bytes, env, lang);
    } catch (e) {
      console.error('[chat] stt error:', e instanceof Error ? e.message : String(e));
      return json(502, { error: 'stt_failed' });
    }
    if (!textIn) return json(200, { text: '', reply: lang === 'en' ? "Didn't catch that, please try again or type." : '没听清，请再录一次或直接打字。' });

    try {
      return json(200, { text: textIn, reply: await runChat(env, userId, textIn) });
    } catch (e) {
      console.error('[chat] voice agent error:', e instanceof Error ? e.message : String(e));
      return json(500, { error: 'agent_error' });
    }
  }

  return json(404, { error: 'not_found' });
}
