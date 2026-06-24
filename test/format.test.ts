import { describe, it, expect } from 'vitest';
import { toPlainText } from '../src/format';

describe('toPlainText — strips markdown (spec 005)', () => {
  it('AC-B1 — removes bold/italic markers', () => {
    expect(toPlainText('这是**粗体**和*斜体*')).toBe('这是粗体和斜体');
    expect(toPlainText('__也是粗体__')).toBe('也是粗体');
  });

  it('AC-B2 — headers, inline code, links', () => {
    expect(toPlainText('### 油耗统计')).toBe('油耗统计');
    expect(toPlainText('用 `log_fuel` 记录')).toBe('用 log_fuel 记录');
    expect(toPlainText('see [文档](https://x.com/y)')).toBe('see 文档');
  });

  it('AC-B2 — code fences', () => {
    expect(toPlainText('```js\nconst a = 1\n```')).toBe('const a = 1\n');
  });

  it('AC-B3 — list markers become bullets', () => {
    expect(toPlainText('- 第一项\n- 第二项')).toBe('• 第一项\n• 第二项');
    expect(toPlainText('* 项目')).toBe('• 项目');
  });

  it('AC-B2 — blockquote marker removed', () => {
    expect(toPlainText('> 引用文字')).toBe('引用文字');
  });
});

describe('toPlainText — preserves tool output (AC-B4)', () => {
  it('keeps emoji, separators, bullets, currency, dates unchanged', () => {
    const fuel = '✅ 已记录（小绿）\n📍 里程：12,580 km\n⛽ 10 L × ¥9.80/L = ¥98';
    expect(toPlainText(fuel)).toBe(fuel);

    const stats = [
      '📊 小绿 · 油耗统计',
      '─'.repeat(32),
      '2026-06-01  2.29 L/100km  206km  ¥38',
      '─'.repeat(32),
      '平均 2.20 L/100km',
    ].join('\n');
    expect(toPlainText(stats)).toBe(stats);

    const list = '🏍 车辆列表\n• 小绿（默认）\n• 通勤车';
    expect(toPlainText(list)).toBe(list);
  });

  it('does not touch hyphen inside dates (only line-leading - becomes bullet)', () => {
    expect(toPlainText('日期 2026-06-01 里程 12-580')).toBe('日期 2026-06-01 里程 12-580');
  });
});
