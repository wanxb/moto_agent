import { describe, it, expect } from 'vitest';
import { classifyComplexity } from '../src/router/classifier';
import type { Message } from '../src/types';

const u = (c: string): Message => ({ role: 'user', content: c });

describe('classifyComplexity', () => {
  it('空消息 → complex', () => {
    expect(classifyComplexity([])).toBe('complex');
  });

  it('非 user 角色消息 → complex', () => {
    const msgs: Message[] = [{ role: 'assistant', content: '你好' }];
    expect(classifyComplexity(msgs)).toBe('complex');
  });

  describe('simple', () => {
    it('问候 → simple', () => {
      expect(classifyComplexity([u('你好')])).toBe('simple');
    });

    it('英文问候 → simple', () => {
      expect(classifyComplexity([u('hi')])).toBe('simple');
      expect(classifyComplexity([u('hello')])).toBe('simple');
    });

    it('确认/感谢 → simple', () => {
      expect(classifyComplexity([u('谢谢')])).toBe('simple');
      expect(classifyComplexity([u('好的')])).toBe('simple');
      expect(classifyComplexity([u('ok')])).toBe('simple');
    });

    it('短且无数字 → simple（纯聊天）', () => {
      expect(classifyComplexity([u('今天天气不错')])).toBe('simple');
    });

    it('单意图加油 → simple', () => {
      expect(classifyComplexity([u('加了10升98块')])).toBe('simple');
    });

    it('简单查询 → simple', () => {
      expect(classifyComplexity([u('查一下油耗')])).toBe('simple');
    });
  });

  describe('complex', () => {
    it('故障排查 → complex', () => {
      expect(classifyComplexity([u('发动机异响怎么办')])).toBe('complex');
      expect(classifyComplexity([u('故障灯亮了')])).toBe('complex');
      expect(classifyComplexity([u('刹车有异响')])).toBe('complex');
    });

    it('复合意图（逗号分隔）→ complex', () => {
      expect(classifyComplexity([u('加了10升98块,顺便查下保养')])).toBe('complex');
    });

    it('复合意图（"同时"连接）→ complex', () => {
      expect(classifyComplexity([u('同时查下油耗和保养记录')])).toBe('complex');
    });

    it('复合意图（"并"连接）→ complex', () => {
      expect(classifyComplexity([u('加油并查保养')])).toBe('complex');
    });

    it('统计对比 → complex', () => {
      expect(classifyComplexity([u('对比一下这个月和上个月的油耗')])).toBe('complex');
      expect(classifyComplexity([u('平均油耗是多少')])).toBe('complex');
    });

    it('复合意图（中文分号）→ complex', () => {
      expect(classifyComplexity([u('加满油；看看该换机油了没')])).toBe('complex');
    });
  });
});
