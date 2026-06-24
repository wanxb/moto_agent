// 把可能含 Markdown 的文本清洗为纯文本，供 Telegram 直接显示（spec 005）。
// Telegram 默认按纯文本发送，未渲染的 markdown 符号会原样出现，影响观感。
// 规则保守：只去 markdown 语法，保留 emoji、─ 分隔线、• 项目符、¥、数字、日期等。
export function toPlainText(s: string): string {
  return s
    // 代码围栏 ```lang ... ```：去掉围栏标记，保留内容
    .replace(/```[a-zA-Z0-9]*\r?\n?/g, '')
    // 行内代码 `code` → code
    .replace(/`([^`]+)`/g, '$1')
    // 粗体 **text** / __text__ → text（先于单星号处理）
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // 斜体 *text* → text（不跨行）
    .replace(/\*([^*\n]+)\*/g, '$1')
    // 标题 ###### text（行首）→ text
    .replace(/^#{1,6}[ \t]+/gm, '')
    // 链接 [文字](url) → 文字
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 引用块 行首 "> " → 去掉标记
    .replace(/^[ \t]*>[ \t]?/gm, '')
    // 无序列表 行首 "- 项" / "* 项" → "• 项"（不影响日期 2026-06-01 或 ─ 分隔线）
    .replace(/^([ \t]*)[-*][ \t]+/gm, '$1• ');
}
