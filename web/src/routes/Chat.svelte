<script lang="ts">
  import { onMount } from 'svelte';
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
  let busyLabel = $state('');     // 等待时占位气泡文案（思考中 / 识别中）
  let ready = $state(false);
  let listEl = $state<HTMLDivElement | undefined>();

  onMount(async () => {
    const me = await getMe();
    if (!me) { location.href = '/login'; return; }
    try {
      const data = await apiJson<{ messages: Msg[] }>('/chat/api?history=1');
      messages = data.messages;
    } catch { /* 空历史，忽略 */ }
    ready = true;
    scrollDown();
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
      scrollDown();
    }
  }

  // 语音：Recorder 录完把 Blob 交来 → 上传 /chat/voice → 渲染识别文字 + Bot 回复。
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

<div class="app">
  <TopBar title={tr(lang, 'title')} onSettings={() => { location.href = '/settings'; }} />

  <div class="messages" bind:this={listEl}>
    {#if ready && messages.length === 0}
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
    <textarea rows="1" placeholder={tr(lang, 'input_ph')} bind:value={input} onkeydown={onKey}></textarea>
    <button class="send" onclick={send} disabled={sending || !input.trim()}>{tr(lang, 'send')}</button>
  </div>
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; max-width: 600px; margin: 0 auto; }
  .messages { flex: 1 1 auto; overflow-y: auto; padding: 12px 14px; -webkit-overflow-scrolling: touch; }
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
  }
  .send {
    flex: 0 0 auto;
    border: none;
    border-radius: 10px;
    background: var(--accent);
    color: #000;
    font-weight: 600;
    padding: 0 18px;
  }
  .send:disabled { opacity: 0.5; }
</style>
