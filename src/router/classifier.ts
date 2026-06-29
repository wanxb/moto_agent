// 纯启发式规则：根据用户消息复杂度判断应走哪层模型。
// 原则：宁可多花钱（simple 判为 complex），不可降低质量（complex 判为 simple）。

import type { Message } from '../types';

export type Complexity = 'simple' | 'complex';

export function classifyComplexity(messages: Message[]): Complexity {
  if (messages.length === 0) return 'complex';

  const last = messages[messages.length - 1];
  if (last.role !== 'user') return 'complex';
  const text = last.content.trim();

  // 空消息 → 安全方向判 complex
  if (!text) return 'complex';

  // ── 简单问候/确认（零或极低 LLM 需求）──
  if (/^(hi|hello|hey|你好|嗨|早|谢谢|thanks|ok|好的|明白|再见|bye|晚安|好)\b/i.test(text)) {
    return 'simple';
  }

  // ── 复杂触发词（需要强模型推理）—— 优先于短消息规则 ──
  // 故障排查
  if (/(故障|异响|报警|灯亮|怎么.*修|为什么|打不着|漏|抖|声音大|检查|诊断|散热|高温|过热|冷却|水温)/.test(text)) return 'complex';
  // 复合意图（逗号/分号分隔且跨领域）
  if (/[，,、；;]/.test(text) && /(加油|油耗|保养|换|提醒|查)/.test(text)) return 'complex';
  // 显式"同时/顺便/另外"连接不同操作
  if (/(同时|顺便|另外|还有|和|与|并)/.test(text) && /(保养|油耗|里程|换|查|加)/.test(text)) return 'complex';
  // 计算/统计/对比
  if (/(平均|统计|区间|计算|总共|对比|哪个.*省|分析)/.test(text)) return 'complex';

  // ── 极短消息 + 无数字（纯聊天/确认）──
  if (text.length < 15 && !/\d/.test(text)) return 'simple';

  // ── 默认：走便宜模型 ──
  return 'simple';
}
