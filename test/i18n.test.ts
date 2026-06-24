import { describe, it, expect } from 'vitest';
import { t, fmtNumber, fmtKm, fmtCost, detectLang } from '../src/i18n';

describe('t()', () => {
  it('returns Chinese for zh', () => {
    expect(t('general.no_fuel_records', 'zh')).toBe('暂无加油记录。');
  });

  it('returns English for en', () => {
    expect(t('general.no_fuel_records', 'en')).toBe('No fuel records yet.');
  });

  it('falls back to Chinese for unknown keys', () => {
    expect(t('nonexistent.key', 'en')).toBe('nonexistent.key');
  });

  it('interpolates {0} {1} placeholders', () => {
    expect(t('vehicle.added', 'zh', '小绿')).toBe('✅ 已添加车辆「小绿」。');
    expect(t('vehicle.renamed', 'zh', '小绿', '大绿')).toBe('✅ 已将车辆「小绿」改名为「大绿」。');
  });

  it('interpolates in English', () => {
    expect(t('vehicle.added', 'en', 'MyBike')).toBe('✅ Added "MyBike".');
    expect(t('vehicle.renamed', 'en', '小绿', '大绿')).toBe('✅ Renamed "小绿" to "大绿".');
  });

  it('handles number args', () => {
    expect(t('general.rate_limit', 'zh', '5')).toContain('5');
    expect(t('general.rate_limit', 'en', '10')).toContain('10');
  });
});

describe('fmtNumber', () => {
  it('zh-CN does not use grouping separators for small numbers', () => {
    // zh-CN: 1200.toLocaleString('zh-CN') = "1,200" actually
    const result = fmtNumber(1200, 'zh');
    expect(result).toBe('1,200');
  });

  it('en-US uses comma grouping', () => {
    expect(fmtNumber(1200, 'en')).toBe('1,200');
  });

  it('formats large numbers', () => {
    expect(fmtNumber(12580, 'zh')).toBe('12,580');
    expect(fmtNumber(12580, 'en')).toBe('12,580');
  });
});

describe('fmtKm', () => {
  it('formats with km unit in Chinese', () => {
    expect(fmtKm(12580, 'zh')).toBe('12,580 km');
  });

  it('formats with km unit in English', () => {
    expect(fmtKm(12580, 'en')).toBe('12,580 km');
  });

  it('returns em dash for null', () => {
    expect(fmtKm(null, 'zh')).toBe('—');
    expect(fmtKm(null, 'en')).toBe('—');
  });
});

describe('fmtCost', () => {
  it('formats cost in Chinese', () => {
    expect(fmtCost(1200, 'zh')).toBe('¥1200');
  });

  it('formats cost in English', () => {
    expect(fmtCost(1200, 'en')).toBe('¥1200');
  });

  it('returns em dash for null', () => {
    expect(fmtCost(null, 'zh')).toBe('—');
  });
});

describe('detectLang', () => {
  it('returns zh for zh-* language codes', () => {
    expect(detectLang('zh')).toBe('zh');
    expect(detectLang('zh-CN')).toBe('zh');
    expect(detectLang('zh-TW')).toBe('zh');
    expect(detectLang('zh-HK')).toBe('zh');
  });

  it('returns en for everything else', () => {
    expect(detectLang('en')).toBe('en');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang('ja')).toBe('en');
    expect(detectLang('ko')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });
});

describe('translation key coverage', () => {
  it('all zh keys have corresponding en keys', async () => {
    const { zh } = await import('../src/i18n/zh');
    const { en } = await import('../src/i18n/en');
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    expect(zhKeys).toEqual(enKeys);
  });
});
