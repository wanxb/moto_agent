<script lang="ts">
  import { onMount } from 'svelte';
  import { getLang, tr } from './lib/i18n';
  import Chat from './routes/Chat.svelte';
  import Login from './routes/Login.svelte';
  import Settings from './routes/Settings.svelte';
  import Dashboard from './routes/Dashboard.svelte';

  // 极简客户端路由：/login /settings /dashboard，其余 → 对话（未登录时各页自行跳 /login）。
  const path = location.pathname;
  const lang = getLang();

  let online = $state(navigator.onLine);

  // 按路由动态设置浏览器 tab title
  function setTitle(page: string) {
    const brand = tr(lang, 'title');
    document.title = page ? `${page} · ${brand}` : brand;
  }

  onMount(() => {
    const onOnline = () => { online = true; };
    const onOffline = () => { online = false; };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    if (path.startsWith('/dashboard')) setTitle(tr(lang, 'dashboard'));
    else if (path.startsWith('/settings')) setTitle(tr(lang, 'settings_title'));
    else if (path.startsWith('/login')) setTitle('');
    else setTitle('');

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  });
</script>

{#if !online}
  <div class="offline-bar">📡 网络已断开</div>
{/if}

<div class="page-enter">
  {#if path.startsWith('/login')}
    <Login />
  {:else if path.startsWith('/settings')}
    <Settings />
  {:else if path.startsWith('/dashboard')}
    <Dashboard />
  {:else}
    <Chat />
  {/if}
</div>

<style>
  .offline-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--yellow);
    color: #fff;
    text-align: center;
    font-size: 0.82rem;
    padding: 6px;
    font-weight: 500;
  }
</style>
