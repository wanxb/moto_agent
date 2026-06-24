import { Message, Env } from './types';
import { TOOLS, dispatchTool } from './tools';
import { callLLM } from './llm';

const MAX_ROUNDS = 4;

export function buildSystemPrompt(): string {
  const today = new Date().toISOString().split('T')[0];
  return `你是一个摩托车油耗管理助手，帮助用户记录加油信息和查询油耗统计。

今天的日期：${today}

处理规则：
1. 用户提供加油信息时，提取日期（默认今天）、里程、升数、总价，调用 log_fuel
2. 只有总价没有升数时（如"加了 100 块"），先询问升数再调用
3. 查询请求根据描述选择时间范围：本月、最近 N 次、某段时间等
4. 工具返回的格式化结果直接回复给用户，不要重新描述
5. 回复简洁，中文

多车规则：
6. 用户可能管理多辆车。消息里提到车名时，把车名作为 vehicle 参数传给对应工具；没提到则不传（工具会用默认车）
7. 工具返回提示需要指明车辆时，按提示向用户反问是哪辆车
8. "我有哪些车"用 list_vehicles；"添加车 xxx"用 add_vehicle；"默认车设成 xxx"用 set_default_vehicle；"把 X 改名叫 Y"用 rename_vehicle

维保规则：
9. 用户记录保养（换机油/轮胎/保险/刹车/链条等）用 log_maintenance，抽取 type、里程、费用、日期；里程或费用没说就不传
10. 查询保养历史用 query_maintenance；问"上次换 X"时传 type=X 且 last_only=true

提醒规则：
11. 设提醒用 set_reminder：里程类（"机油每3000公里"→mode=mileage,interval_km=3000；"机油到13000提醒"→mode=mileage,trigger_odometer=13000）；日期类（"保险2027-01-05到期"→mode=date,trigger_date=2027-01-05）
12. "我设了哪些提醒"用 list_reminders；"取消X提醒"用 cancel_reminder（传 type=X）

纠错规则：
13. 用户要改最近一条加油记录（"上一条里程改成X""上次写错了，是9升"）用 update_last_fuel，只传要改的字段
14. 用户要删最近一条加油记录（"删掉刚才那条""删除最近记录"）用 delete_last_fuel

输出规则：
15. 用纯文本回复，不要用 Markdown 语法（不要出现 ** * \` # > 等符号），可以用 emoji 和换行来排版`;
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
