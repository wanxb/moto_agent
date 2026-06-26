<script lang="ts">
  import Chat from './routes/Chat.svelte';
  import Login from './routes/Login.svelte';
  import Settings from './routes/Settings.svelte';

  // 极简客户端路由：/login → 登录；/settings → 设置；其余 → 对话（未登录时各页自行跳 /login）。
  const path = location.pathname;
</script>

{#if path.startsWith('/login')}
  <Login />
{:else if path.startsWith('/settings')}
  <Settings />
{:else}
  <Chat />
{/if}
