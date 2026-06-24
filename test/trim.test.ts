import { describe, it, expect } from 'vitest';
import { trimHistory } from '../src/session';
import type { Message } from '../src/types';

// 构造便捷消息
const u = (c: string): Message => ({ role: 'user', content: c });
const a = (c: string): Message => ({ role: 'assistant', content: c });
const aTool = (id: string): Message => ({
  role: 'assistant', content: null,
  tool_calls: [{ id, type: 'function', function: { name: 'get_last_record', arguments: '{}' } }],
});
const tool = (id: string): Message => ({ role: 'tool', tool_call_id: id, content: '结果' });

describe('trimHistory — 按完整回合截断（spec 007）', () => {
  it('短历史原样返回（已从 user 开始）', () => {
    const m = [u('1'), a('r1'), u('2'), a('r2')];
    expect(trimHistory(m, 10)).toEqual(m);
  });

  it('超长时从 user 边界截断，不从中间起', () => {
    const m = [u('1'), a('r1'), u('2'), a('r2'), u('3'), a('r3'), u('4'), a('r4'), u('5'), a('r5'), u('6'), a('r6')];
    const out = trimHistory(m, 6);
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out[0].role).toBe('user');     // 必从 user 开始
    expect(out[out.length - 1]).toEqual(a('r6'));
  });

  it('不把 assistant 的 tool_calls 与其 tool 结果切散', () => {
    // 回合1：u,aTool,tool,a   回合2：u,aTool,tool,a
    const m = [
      u('1'), aTool('c1'), tool('c1'), a('好了1'),
      u('2'), aTool('c2'), tool('c2'), a('好了2'),
    ];
    const out = trimHistory(m, 6);   // 6 < 8，需截
    expect(out[0].role).toBe('user');
    // 开头不应是悬空的 tool 或 assistant(tool_calls)
    expect(out[0].role).not.toBe('tool');
    // 若包含某个 tool 结果，其前面必有对应 assistant tool_calls（从 user 边界起即可保证）
    const firstUserIdx = out.findIndex(x => x.role === 'user');
    expect(firstUserIdx).toBe(0);
  });

  it('单个超长回合：退而保留最后一个 user 起（宁可超额也不切坏）', () => {
    const m = [u('1'), a('r1'), u('2'), aTool('c'), tool('c'), aTool('c2'), tool('c2'), a('done')];
    // maxMessages=3，但最后一个 user(索引2) 之后有 6 条
    const out = trimHistory(m, 3);
    expect(out[0]).toEqual(u('2'));   // 从最后一个 user 起，完整保留该回合
  });

  it('空历史返回空', () => {
    expect(trimHistory([], 10)).toEqual([]);
  });
});
