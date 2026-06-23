import { Message, Env } from './types';
import { TOOLS, dispatchTool } from './tools';
import { callLLM } from './llm';

const MAX_ROUNDS = 4;

function buildSystemPrompt(): string {
  const today = new Date().toISOString().split('T')[0];
  return `你是一个摩托车油耗管理助手，帮助用户记录加油信息和查询油耗统计。

今天的日期：${today}

处理规则：
1. 用户提供加油信息时，提取日期（默认今天）、里程、升数、总价，调用 log_fuel
2. 只有总价没有升数时（如"加了 100 块"），先询问升数再调用
3. 查询请求根据描述选择时间范围：本月、最近 N 次、某段时间等
4. 工具返回的格式化结果直接回复给用户，不要重新描述
5. 回复简洁，中文`;
}

export async function agentLoop(messages: Message[], env: Env): Promise<string> {
  const systemMsg: Message = { role: 'system', content: buildSystemPrompt() };
  // Work on a copy so the caller's messages array tracks only user/assistant turns
  const working: Message[] = [systemMsg, ...messages];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await callLLM(working, TOOLS, env.DEEPSEEK_API_KEY, env.ANTHROPIC_API_KEY);

    working.push(response.assistantMessage);
    messages.push(response.assistantMessage);

    if (!response.toolCalls?.length) {
      return response.textContent ?? '（无回复）';
    }

    // Execute each tool call
    for (const tc of response.toolCalls) {
      let result: string;
      try {
        result = await dispatchTool(tc.name, tc.input, env.DB);
        console.log(`[tool] ${tc.name} →`, result.slice(0, 80));
      } catch (e) {
        result = `工具执行失败：${e instanceof Error ? e.message : String(e)}`;
        console.error(`[tool] ${tc.name} error:`, e);
      }
      const toolMsg: Message = { role: 'tool', tool_call_id: tc.id, content: result };
      working.push(toolMsg);
      messages.push(toolMsg);
    }
  }

  return '处理超时，请重试。';
}
