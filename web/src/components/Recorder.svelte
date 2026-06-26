<script lang="ts">
  import { tr, type Lang } from '../lib/i18n';

  // 按住录音、松开发送：捕获音频后经 onAudio 把 Blob 交给父组件上传。
  // 录音/上传期间由父组件传 busy 置灰，避免并发。
  let { onAudio, lang, busy = false }: {
    onAudio: (blob: Blob) => void;
    lang: Lang;
    busy?: boolean;
  } = $props();

  let recording = $state(false);
  let denied = $state(false);

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let cancelled = false;

  // Whisper 接受 ogg/webm-opus；按浏览器支持度挑一个，挑不到用默认。
  function pickMime(): string {
    const prefs = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const m of prefs) if (MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }

  function releaseStream() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    recorder = null;
  }

  async function start() {
    if (recording || busy || denied) return;
    cancelled = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      denied = true; // 权限拒绝/无设备：按钮置灰
      return;
    }
    const mime = pickMime();
    chunks = [];
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const type = recorder?.mimeType || 'audio/webm';
      releaseStream();
      if (cancelled) { chunks = []; return; }
      const blob = new Blob(chunks, { type });
      chunks = [];
      if (blob.size > 0) onAudio(blob);
    };
    recorder.start();
    recording = true;
  }

  function stop(cancel = false) {
    if (!recording) return;
    cancelled = cancel;
    recording = false;
    try { recorder?.stop(); } catch { releaseStream(); }
  }
</script>

<button
  class="mic"
  class:recording
  disabled={busy || denied}
  title={denied ? tr(lang, 'mic_denied') : tr(lang, 'mic_hold')}
  aria-label={tr(lang, 'mic_hold')}
  onpointerdown={(e) => { e.preventDefault(); start(); }}
  onpointerup={() => stop(false)}
  onpointerleave={() => stop(true)}
  onpointercancel={() => stop(true)}
  oncontextmenu={(e) => e.preventDefault()}
>
  {recording ? '🔴' : '🎤'}
</button>

{#if recording}
  <span class="hint">{tr(lang, 'mic_recording')}</span>
{/if}

<style>
  .mic {
    flex: 0 0 auto;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--card);
    color: var(--text);
    font-size: 1.1rem;
    padding: 0 14px;
    touch-action: none;        /* 按住时禁止页面滚动 */
    user-select: none;
    -webkit-user-select: none;
  }
  .mic:disabled { opacity: 0.4; }
  .mic.recording {
    background: var(--red);
    border-color: var(--red);
    animation: pulse 1s ease-in-out infinite;
  }
  @keyframes pulse { 50% { opacity: 0.6; } }
  .hint {
    position: absolute;
    bottom: 64px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--red);
    color: #fff;
    font-size: 0.8rem;
    padding: 4px 12px;
    border-radius: 12px;
  }
</style>
