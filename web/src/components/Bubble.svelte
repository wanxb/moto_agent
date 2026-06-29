<script lang="ts">
  let { role, content }: { role: string; content: string } = $props();

  // ── 轻量 Markdown → HTML ────────────────────────────────────────────────
  // 仅渲染 Agent 回复中常用的格式：**加粗**、`行内代码`、```代码块```、- 列表、URL链接。
  // 先转义 HTML 防 XSS，再逐行解析。

  function md(text: string): string {
    // 1. HTML 转义
    let safe = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // 2. 保护代码块（```...```），不让后续处理污染
    const blocks: string[] = [];
    safe = safe.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
      blocks.push(`<pre><code>${code.trim()}</code></pre>`);
      return `\x00B${blocks.length - 1}\x00`;
    });

    // 3. 逐行处理列表
    const lines = safe.split('\n');
    const out: string[] = [];
    let inUl = false;

    for (const line of lines) {
      const li = line.match(/^\s*[-*]\s+(.+)$/);
      if (li) {
        if (!inUl) { out.push('<ul>'); inUl = true; }
        out.push(`<li>${inline(li[1])}</li>`);
      } else {
        if (inUl) { out.push('</ul>'); inUl = false; }
        if (line.trim() === '') {
          out.push('<br>');
        } else {
          out.push(inline(line) + '<br>');
        }
      }
    }
    if (inUl) out.push('</ul>');

    // 4. 恢复代码块
    return out.join('').replace(/\x00B(\d+)\x00/g, (_m, i) => blocks[+i]);
  }

  function inline(t: string): string {
    return t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(
        /https?:\/\/[^\s<">]+/g,
        (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`,
      );
  }

  const html = $derived(md(content));
</script>

<div class="row {role}">
  <div class="bubble">{@html html}</div>
</div>

<style>
  .row { display: flex; margin: 6px 0; }
  .row.user { justify-content: flex-end; }
  .row.assistant { justify-content: flex-start; }
  .bubble {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 14px;
    line-height: 1.5;
    font-size: 0.95rem;
    overflow-wrap: break-word;
  }
  .user .bubble { background: var(--blue); color: #fff; border-bottom-right-radius: 4px; }
  .assistant .bubble { background: var(--card); border: 1px solid var(--border); border-bottom-left-radius: 4px; }

  /* Markdown 样式 */
  .bubble :global(pre) {
    background: rgba(0,0,0,0.25);
    border-radius: 8px;
    padding: 8px 10px;
    overflow-x: auto;
    font-size: 0.82rem;
    margin: 6px 0;
  }
  .bubble :global(code) {
    background: rgba(0,0,0,0.2);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 0.88em;
  }
  .bubble :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.82rem;
  }
  .bubble :global(strong) { font-weight: 700; }
  .bubble :global(ul) {
    margin: 4px 0;
    padding-left: 20px;
    list-style: disc;
  }
  .bubble :global(li) { margin: 2px 0; }
  .bubble :global(a) { color: var(--accent); text-decoration: underline; }
  .bubble :global(br) { content: ''; display: block; margin: 4px 0; }

  /* 用户气泡里 Markdown 也保持一致（白底蓝字） */
  .user .bubble :global(a) { color: #fff; text-decoration: underline; }
  .user .bubble :global(pre) { background: rgba(0,0,0,0.15); }
  .user .bubble :global(code) { background: rgba(0,0,0,0.15); }
</style>
