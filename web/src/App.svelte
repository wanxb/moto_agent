<script lang="ts">
  import { onMount } from 'svelte';
  import Chat from './routes/Chat.svelte';
  import Login from './routes/Login.svelte';
  import Settings from './routes/Settings.svelte';
  import Dashboard from './routes/Dashboard.svelte';

  // 极简客户端路由：/login /settings /dashboard，其余 → 对话（未登录时各页自行跳 /login）。
  const path = location.pathname;

  let online = $state(navigator.onLine);

  onMount(() => {
    const onOnline = () => { online = true; };
    const onOffline = () => { online = false; };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
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
