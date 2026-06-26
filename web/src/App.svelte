<script lang="ts">
  import { onMount } from 'svelte';
  import { getMe, type Me } from './lib/session';

  // 脚手架占位：真实路由与页面（Login / Chat / Settings）见 T5 / T8。
  let path = $state(location.pathname);
  let me = $state<Me | null>(null);
  let loading = $state(true);

  onMount(async () => {
    me = await getMe();
    loading = false;
  });
</script>

<main>
  <h1>🏍 Moto Bot</h1>
  {#if loading}
    <p class="muted">加载中…</p>
  {:else}
    <p class="muted">当前路由：<code>{path}</code></p>
    <p class="muted">{me ? `已登录：${me.email ?? me.telegram_id}` : '未登录'}</p>
    <p class="muted">页面建设中：Login / Chat / Settings（见 spec 016 T5 / T8）。</p>
  {/if}
</main>

<style>
  main { max-width: 480px; margin: 0 auto; padding: 24px; text-align: center; }
  h1 { font-size: 1.4rem; margin: 16px 0; }
  .muted { color: var(--muted); margin: 8px 0; line-height: 1.5; }
  code { color: var(--accent); }
</style>
