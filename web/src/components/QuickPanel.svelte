<script lang="ts">
  type Item = { icon: string; label: string; action: () => void };
  let { items }: { items: Item[] } = $props();
</script>

<div class="panel">
  {#each items as it}
    <button class="card" onclick={it.action}>
      <span class="i">{it.icon}</span>
      <span class="l">{it.label}</span>
    </button>
  {/each}
</div>

<style>
  .panel {
    flex: 0 0 auto;
    display: flex;
    gap: 8px;
    padding: 8px 12px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .panel::-webkit-scrollbar { display: none; }
  .card {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 64px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--text);
  }
  .i { font-size: 1.2rem; }
  .l { font-size: 0.72rem; color: var(--muted); }
</style>
