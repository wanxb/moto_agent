// 依赖注入容器：把 Env（Cloudflare 运行时绑定）组装为领域对象。
// 所有具体实现来自 infra/，通过 ports 接口对外暴露。

import type { Env, Message } from './types';
import type { IMessenger, ISessionStore, ITTSProvider, ILLMProvider } from './ports';
import type { Lang } from './i18n/types';
import { TelegramMessenger } from './infra/telegram-messenger';
import { CFKVSession } from './infra/cf-kv-session';
import { CFWhisperSTT } from './infra/cf-whisper-stt';
import { DeepSeekLLM } from './infra/deepseek-llm';
import { FallbackLLM } from './infra/fallback-llm';
import { RouterLLM } from './router';
import { runAgentLoop } from './agent';
import { registry } from './tools';
import { SearchKnowledgeTool } from './tools/knowledge-tools';
import { runPipeline, type AgentRunner } from './gateway/pipeline';
import type { ChannelAdapter } from './ports';

export interface App {
  messenger: IMessenger;
  session: ISessionStore;
  stt: ITTSProvider;
  llm: ILLMProvider;
  db: D1Database;
  kv: KVNamespace;
  botToken: string;
  allowedChatId?: string;
  agent: AgentRunner;
  run: (adapter: ChannelAdapter, raw: unknown) => Promise<string | null>;
}

/** 从 Env 创建全部对象（production / dev 共用） */
export function bootstrap(env: Env): App {
  const messenger = new TelegramMessenger(env.TELEGRAM_BOT_TOKEN);

  // ── 模型层：两层 FallbackLLM + RouterLLM ──────────────────────────────
  const flash = new DeepSeekLLM(env.DEEPSEEK_API_KEY, 'deepseek-v4-flash');
  const pro = new DeepSeekLLM(env.DEEPSEEK_API_KEY, 'deepseek-v4-pro');

  // 简单层：Flash ×3 → Pro ×1
  const simpleTier = new FallbackLLM(flash, pro, 3);
  // 复杂层：Pro ×3 → Flash ×1
  const complexTier = new FallbackLLM(pro, flash, 3);

  const llm = new RouterLLM(simpleTier, complexTier);

  // 注册知识库搜索工具（需要 Env 中的 AI/KNOWLEDGE_INDEX 绑定）
  registry.register(new SearchKnowledgeTool(env.AI, env.KNOWLEDGE_INDEX));
  const tools = registry.toOpenAI();
  const agent: AgentRunner = (messages: Message[], db: D1Database, lang?: Lang, userId?: number) =>
    runAgentLoop(messages, llm, tools, registry, db, lang, userId);

  const base = {
    messenger, session: new CFKVSession(env.SESSION_KV),
    stt: new CFWhisperSTT(env), llm,
    db: env.DB, kv: env.SESSION_KV,
    botToken: env.TELEGRAM_BOT_TOKEN,
    allowedChatId: env.ALLOWED_CHAT_ID || undefined,
  };

  const run = (adapter: ChannelAdapter, raw: unknown) =>
    runPipeline(adapter, raw, { ...base, agent });

  return { ...base, agent, run };
}

export { registry as tools };
