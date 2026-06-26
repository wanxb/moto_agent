<script lang="ts">
  let { role, content }: { role: string; content: string } = $props();
</script>

<div class="row {role}">
  <div class="bubble">{content}</div>
</div>

<style>
  .row { display: flex; margin: 6px 0; }
  .row.user { justify-content: flex-end; }
  .row.assistant { justify-content: flex-start; }
  .bubble {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 14px;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.45;
    font-size: 0.95rem;
  }
  .user .bubble { background: var(--blue); color: #fff; border-bottom-right-radius: 4px; }
  .assistant .bubble { background: var(--card); border: 1px solid var(--border); border-bottom-left-radius: 4px; }
</style>
