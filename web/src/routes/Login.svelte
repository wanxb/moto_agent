<script lang="ts">
  import { getLang, tr } from '../lib/i18n';

  // 最小登录页：邮箱 → 魔法链接。设置页与绑定验证码输入在 T8 补全。
  const lang = getLang();
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let email = $state('');
  let status = $state<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function submit(e: Event) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) { status = 'error'; return; }
    status = 'sending';
    try {
      const res = await fetch('/auth/send-link', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      status = res.ok ? 'sent' : 'error';
    } catch {
      status = 'error';
    }
  }
</script>

<main>
  <h1>🏍 {tr(lang, 'title')}</h1>
  <p class="sub">{tr(lang, 'login_title')}</p>

  {#if status === 'sent'}
    <p class="ok">{tr(lang, 'sent')}</p>
  {:else}
    <form onsubmit={submit}>
      <input type="email" placeholder={tr(lang, 'email_ph')} bind:value={email} autocomplete="email" />
      <button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? tr(lang, 'sending') : tr(lang, 'send_link')}
      </button>
      {#if status === 'error'}<p class="err">{tr(lang, 'send_failed')}</p>{/if}
    </form>
    <div class="sep"><span>{tr(lang, 'or')}</span></div>
    <button class="google" onclick={() => { location.href = '/auth/google'; }}>
      🅶 {tr(lang, 'google_login')}
    </button>
    <p class="hint">✉️ {tr(lang, 'login_hint')}</p>
  {/if}
</main>

<style>
  main { max-width: 360px; margin: 0 auto; padding: 48px 24px; text-align: center; }
  h1 { font-size: 1.4rem; margin-bottom: 6px; }
  .sub { color: var(--muted); margin-bottom: 28px; }
  form { display: flex; flex-direction: column; gap: 12px; }
  input {
    border: 1px solid var(--border); border-radius: 10px;
    background: var(--card); color: var(--text); padding: 13px 14px; font-size: 1rem;
  }
  button {
    border: none; border-radius: 10px; background: var(--accent); color: #000;
    font-weight: 600; font-size: 1rem; padding: 13px;
  }
  button:disabled { opacity: 0.6; }
  .hint { color: var(--muted); font-size: 0.85rem; margin-top: 18px; line-height: 1.5; }
  .sep { display: flex; align-items: center; margin: 14px 0; }
  .sep::before, .sep::after { content: ''; flex: 1; border-top: 1px solid var(--border); }
  .sep span { padding: 0 12px; color: var(--muted); font-size: 0.8rem; }
  .google { width: 100%; padding: 13px; border: 1px solid var(--border); border-radius: 10px;
    background: #4285f4; color: #fff; font-size: 1rem; font-weight: 500; cursor: pointer; }
  .google:hover { background: #3367d6; }
  .ok { color: var(--green); margin-top: 24px; font-size: 1rem; }
  .err { color: var(--red); font-size: 0.85rem; }
</style>
