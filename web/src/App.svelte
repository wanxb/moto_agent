<script lang="ts">
  import Chat from './routes/Chat.svelte';
  import Login from './routes/Login.svelte';

  // 极简客户端路由：/login → 登录页；其余 → 对话页（未登录时 Chat 自行跳 /login）。
  // 设置页 /settings 在 T8 接入。
  const path = location.pathname;
</script>

{#if path.startsWith('/login')}
  <Login />
{:else}
  <Chat />
{/if}
