// i18n 核心（spec 010）— 翻译、数字格式化、语言偏好读写。

import type { Lang } from './types';
import { zh } from './zh';
import { en } from './en';

const DICT: Record<Lang, Record<string, string>> = { zh, en };
const LOCALE: Record<Lang, string> = { zh: 'zh-CN', en: 'en-US' };

// ── 翻译 ──────────────────────────────────────────────────────────────────────

/** 按 key 获取翻译，支持 {0} {1} … 占位替换。key 不存在时返回 key 本身（方便发现漏翻）。 */
export function t(key: string, lang: Lang, ...args: (string | number)[]): string {
  const dict = DICT[lang];
  let template = dict[key];
  if (template === undefined) {
    template = DICT.zh[key]; // fallback 中文
    if (template === undefined) return key;
  }
  return template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}

// ── 数字格式化 ────────────────────────────────────────────────────────────────

/** 数字按语言格式化（中文不分组，英文千分位逗号）。 */
export function fmtNumber(n: number, lang: Lang): string {
  return n.toLocaleString(LOCALE[lang]);
}

/** 里程格式化 */
export function fmtKm(n: number | null, lang: Lang): string {
  if (n == null) return '—';
  return `${fmtNumber(n, lang)} ${t('unit.km', lang)}`;
}

/** 费用格式化 */
export function fmtCost(n: number | null, _lang: Lang): string {
  if (n == null) return '—';
  return `¥${n}`;  // 费用不分组，保持 ¥1200 格式
}

/** 单价格式化 */
export function fmtPricePerL(n: number, lang: Lang): string {
  return t('unit.yuan_per_l', lang, n.toFixed(2));
}

// ── 语言偏好（KV）──────────────────────────────────────────────────────────────

const LANG_KEY_PREFIX = 'lang:';
const LANG_TTL = 30 * 86400; // 30 天

/** 读取用户语言偏好。KV 未设置时返回 null。 */
export async function getLang(kv: KVNamespace, chatId: string): Promise<Lang | null> {
  const v = await kv.get(`${LANG_KEY_PREFIX}${chatId}`);
  if (v === 'zh' || v === 'en') return v;
  return null;
}

/** 写入用户语言偏好 */
export async function setLang(kv: KVNamespace, chatId: string, lang: Lang): Promise<void> {
  await kv.put(`${LANG_KEY_PREFIX}${chatId}`, lang, { expirationTtl: LANG_TTL });
}

/** 从 Telegram language_code 推断系统语言。只区分 zh 和 en。 */
export function detectLang(languageCode?: string): Lang {
  if (languageCode && languageCode.startsWith('zh')) return 'zh';
  return 'en'; // 非中文用户默认英文
}
