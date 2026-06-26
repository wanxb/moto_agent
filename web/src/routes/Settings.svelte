<script lang="ts">
  import { onMount } from 'svelte';
  import { getLang, setLang, tr, type Lang } from '../lib/i18n';
  import { getMe, type Me } from '../lib/session';
  import { postJson } from '../lib/api';

  let lang = $state<Lang>(getLang());
  let me = $state<Me | null>(null);
  let code = $state('');
  let binding = $state(false);
  let bindMsg = $state<{ ok: boolean; text: string } | null>(null);

  onMount(async () => {
    me = await getMe();
    if (!me) { location.href = '/login'; return; }
    lang = me.lang === 'en' ? 'en' : 'zh';  // 以 DB 偏好为准
  });

  async function switchLang(next: Lang) {
    if (next === lang) return;
    lang = next;
    setLang(next);
    try { await postJson('/api/v1/me', { lang: next }); } catch { /* UI 已切，持久化失败忽略 */ }
  }

  async function bind() {
    if (!me?.email || code.trim().length < 4 || binding) return;
    binding = true;
    bindMsg = null;
    try {
      const res = await postJson('/auth/bind', { email: me.email, code: code.trim() });
      if (res.ok) {
        bindMsg = { ok: true, text: tr(lang, 'bind_ok') };
        code = '';
        me = await getMe();   // 刷新绑定状态
      } else {
        bindMsg = { ok: false, text: tr(lang, 'bind_fail') };
      }
    } catch {
      bindMsg = { ok: false, text: tr(lang, 'bind_fail') };
    } finally {
      binding = false;
    }
  }

  async function logout() {
    try { await postJson('/auth/logout', {}); } catch { /* 无论成败都回登录页 */ }
    location.href = '/login';
  }
</script>

<div class="wrap">
  <header>
    <button class="link" onclick={() => { location.href = '/chat'; }}>‹ {tr(lang, 'back')}</button>
    <h1>{tr(lang, 'settings_title')}</h1>
    <span class="spacer"></span>
  </header>

  {#if me}
    <section>
      <h2>{tr(lang, 'account')}</h2>
      <div class="row"><span class="k">{tr(lang, 'email_label')}</span><span class="v">{me.email ?? tr(lang, 'not_set')}</span></div>
      <div class="row">
        <span class="k">{tr(lang, 'tg_status')}</span>
        <span class="v">{me.telegram_id ? `${tr(lang, 'bound')} · ${me.telegram_id}` : tr(lang, 'not_bound')}</span>
      </div>
    </section>

    <section>
      <h2>{tr(lang, 'language')}</h2>
      <div class="segmented">
        <button class:active={lang === 'zh'} onclick={() => switchLang('zh')}>中文</button>
        <button class:active={lang === 'en'} onclick={() => switchLang('en')}>English</button>
      </div>
    </section>

    {#if me.telegram_id}
      <section>
        <h2>{tr(lang, 'tg_status')}</h2>
        <p class="hint">{tr(lang, 'unbind_hint')}</p>
      </section>
    {:else}
      <section>
        <h2>{tr(lang, 'bind_title')}</h2>
        <p class="hint">{tr(lang, 'bind_help')}</p>
        <div class="bindrow">
          <input inputmode="numeric" maxlength="6" placeholder={tr(lang, 'code_ph')} bind:value={code} />
          <button class="primary" onclick={bind} disabled={binding || code.trim().length < 4}>{tr(lang, 'bind_btn')}</button>
        </div>
        {#if bindMsg}<p class={bindMsg.ok ? 'ok' : 'err'}>{bindMsg.text}</p>{/if}
      </section>
    {/if}

    <section>
      <button class="danger" onclick={logout}>{tr(lang, 'logout')}</button>
    </section>
  {/if}
</div>

<style>
  .wrap { max-width: 600px; margin: 0 auto; padding: 0 14px 32px; }
  header { display: flex; align-items: center; gap: 8px; padding: 12px 0; }
  header h1 { font-size: 1.1rem; flex: 1; text-align: center; }
  .spacer { width: 48px; }
  .link { background: none; border: none; color: var(--accent); font-size: 0.95rem; }
  section { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; margin-top: 12px; }
  h2 { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 10px; }
  .row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; font-size: 0.95rem; }
  .k { color: var(--muted); }
  .v { color: var(--text); word-break: break-all; text-align: right; }
  .hint { color: var(--muted); font-size: 0.85rem; line-height: 1.5; margin-bottom: 10px; }
  .segmented { display: flex; gap: 8px; }
  .segmented button {
    flex: 1; padding: 10px; border-radius: 10px; border: 1px solid var(--border);
    background: var(--bg); color: var(--text); font-size: 0.95rem;
  }
  .segmented button.active { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
  .bindrow { display: flex; gap: 8px; }
  .bindrow input {
    flex: 1; border: 1px solid var(--border); border-radius: 10px;
    background: var(--bg); color: var(--text); padding: 11px 12px; font-size: 1rem; letter-spacing: 0.2em;
  }
  .primary { border: none; border-radius: 10px; background: var(--accent); color: #000; font-weight: 600; padding: 0 18px; }
  .primary:disabled { opacity: 0.5; }
  .danger {
    width: 100%; border: 1px solid var(--red); border-radius: 10px;
    background: transparent; color: var(--red); font-size: 0.95rem; padding: 12px;
  }
  .ok { color: var(--green); font-size: 0.85rem; margin-top: 10px; }
  .err { color: var(--red); font-size: 0.85rem; margin-top: 10px; }
</style>
