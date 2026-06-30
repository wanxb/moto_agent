<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getLang, tr } from '../lib/i18n';
  import { apiJson, postJson, postForm } from '../lib/api';
  import { getMe } from '../lib/session';
  import TopBar from '../components/TopBar.svelte';
  import Bubble from '../components/Bubble.svelte';
  import QuickPanel from '../components/QuickPanel.svelte';
  import Recorder from '../components/Recorder.svelte';

  type Msg = { role: string; content: string };

  const lang = getLang();
  let messages = $state<Msg[]>([]);
  let input = $state('');
  let sending = $state(false);
  let busyLabel = $state('');
  let ready = $state(false);
  let listEl = $state<HTMLDivElement | undefined>();
  let inputEl = $state<HTMLTextAreaElement | undefined>();
  let viewportHeight = $state('100dvh');
  let viewportCleanup: (() => void) | undefined;

  onMount(async () => {
    // 键盘适配：dvh 覆盖大部分现代浏览器；visualViewport 兜底旧设备
    if (window.visualViewport) {
      const updateHeight = () => {
        viewportHeight = `${window.visualViewport!.height}px`;
      };
      window.visualViewport.addEventListener('resize', updateHeight);
      window.visualViewport.addEventListener('scroll', updateHeight);
      viewportCleanup = () => {
        window.visualViewport!.removeEventListener('resize', updateHeight);
        window.visualViewport!.removeEventListener('scroll', updateHeight);
      };
      // 立即同步一次（避免 dvh 和 visualViewport 初始值不一致）
      updateHeight();
    }

    const me = await getMe();
    if (!me) { location.href = '/login'; return; }
    try {
      const data = await apiJson<{ messages: Msg[] }>('/chat/api?history=1');
      messages = data.messages;
    } catch { /* 空历史忽略 */ }
    ready = true;
    scrollDown();
  });

  onDestroy(() => {
    viewportCleanup?.();
  });

  function scrollDown() {
    queueMicrotask(() => { if (listEl) listEl.scrollTop = listEl.scrollHeight; });
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    input = '';
    messages = [...messages, { role: 'user', content: text }];
    sending = true;
    busyLabel = tr(lang, 'thinking');
    scrollDown();
    try {
      const res = await postJson('/chat/api', { text });
      const data = (await res.json()) as { reply?: string };
      messages = [...messages, { role: 'assistant', content: data.reply ?? '…' }];
    } catch {
      messages = [...messages, { role: 'assistant', content: '⚠️ ' + tr(lang, 'error') }];
    } finally {
      sending = false;
      busyLabel = '';
      inputEl?.focus();
      scrollDown();
    }
  }

  // textarea 自动增高
  function onInput() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  }

  async function sendVoice(blob: Blob) {
    if (sending) return;
    sending = true;
    busyLabel = tr(lang, 'transcribing');
    scrollDown();
    try {
      const form = new FormData();
      form.append('audio', blob, 'voice.webm');
      const res = await postForm('/chat/voice', form);
      const data = (await res.json()) as { text?: string; reply?: string };
      if (!res.ok) throw new Error('voice');
      if (data.text) messages = [...messages, { role: 'user', content: data.text }];
      messages = [...messages, { role: 'assistant', content: data.reply ?? '…' }];
    } catch {
      messages = [...messages, { role: 'assistant', content: '⚠️ ' + tr(lang, 'voice_failed') }];
    } finally {
      sending = false;
      busyLabel = '';
      inputEl?.focus();
      scrollDown();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const quick = [
    { icon: '📊', label: tr(lang, 'dashboard'), action: () => { location.href = '/dashboard'; } },
    { icon: '⛽', label: tr(lang, 'logFuel'),   action: () => { input = lang === 'en' ? 'Add fuel: ' : '加油 '; } },
    { icon: '🚗', label: tr(lang, 'vehicles'),  action: () => { input = lang === 'en' ? 'my vehicles' : '我的车'; send(); } },
    { icon: '📋', label: tr(lang, 'history'),   action: () => { input = lang === 'en' ? 'recent fuel stats' : '最近油耗'; send(); } },
  ];
</script>

<div class="app" style="height: {viewportHeight}">
  <TopBar title={tr(lang, 'title')} onSettings={() => { location.href = '/settings'; }} />

  <div class="messages" bind:this={listEl}>
    {#if !ready}
      <div class="skeleton-list">
        <div class="sk sk-assistant"><div class="shimmer" style="width:68%"></div></div>
        <div class="sk sk-user"><div class="shimmer" style="width:45%"></div></div>
        <div class="sk sk-assistant"><div class="shimmer" style="width:82%"></div></div>
        <div class="sk sk-assistant"><div class="shimmer" style="width:38%"></div></div>
      </div>
    {:else if messages.length === 0}
      <p class="empty">{tr(lang, 'empty')}</p>
    {/if}
    {#each messages as m}
      <Bubble role={m.role} content={m.content} />
    {/each}
    {#if sending}
      <Bubble role="assistant" content={busyLabel || tr(lang, 'thinking')} />
    {/if}
  </div>

  <QuickPanel items={quick} />

  <div class="inputbar">
    <Recorder {lang} busy={sending} onAudio={sendVoice} />
    <textarea
      bind:this={inputEl}
      rows="1"
      placeholder={tr(lang, 'input_ph')}
      bind:value={input}
      onkeydown={onKey}
      oninput={onInput}
      disabled={sending}
    ></textarea>
    <button class="send" onclick={send} disabled={sending || !input.trim()}>{tr(lang, 'send')}</button>
  </div>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    max-width: 600px;
    margin: 0 auto;
    transition: height 0.15s ease;
  }
  .messages {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 12px 14px;
    -webkit-overflow-scrolling: touch;
  }
  .empty { color: var(--muted); text-align: center; margin-top: 40px; }
  .inputbar {
    flex: 0 0 auto;
    display: flex;
    gap: 8px;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
    background: var(--card);
  }
  textarea {
    flex: 1 1 auto;
    resize: none;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg);
    color: var(--text);
    padding: 10px 12px;
    font-size: 0.95rem;
    max-height: 120px;
    line-height: 1.4;
    outline: none;
  }
  textarea:focus { border-color: var(--accent); }
  textarea:disabled { opacity: 0.5; }
  .send {
    flex: 0 0 auto;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: #000;
    font-weight: 600;
    padding: 0 18px;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  .send:disabled { opacity: 0.4; }
  .send:active { transform: scale(0.96); }

  /* — 骨架屏 — */
  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 8px 0;
  }
  .sk { display: flex; }
  .sk-user { justify-content: flex-end; }
  .sk-assistant { justify-content: flex-start; }
  .sk .shimmer {
    height: 36px;
    border-radius: 14px;
    background: linear-gradient(90deg, var(--border) 25%, hsl(220,13%,22%) 50%, var(--border) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.6s ease-in-out infinite;
  }
  .sk-user .shimmer { border-bottom-right-radius: 4px; }
  .sk-assistant .shimmer { border-bottom-left-radius: 4px; }
  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>
