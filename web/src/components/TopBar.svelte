<script lang="ts">
  let { title, onSettings }: { title: string; onSettings: () => void } = $props();
</script>

<header>
  <span class="brand">🏍 {title}</span>
  <button class="gear" onclick={onSettings} aria-label="settings">⚙️</button>
</header>

<style>
  header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--card);
    border-bottom: 1px solid var(--border);
  }
  .brand { font-size: 1.05rem; font-weight: 600; }
  .gear { background: none; border: none; font-size: 1.2rem; padding: 4px 8px; color: var(--text); }
</style>
