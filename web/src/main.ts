import { mount } from 'svelte';
import './theme.css';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

// ── PWA：Service Worker 注册（离线缓存）─────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // SW 注册失败不影响主功能
  });
}

// ── PWA：添加到主屏幕引导（Android Chrome）─────────────────────────────
// Settings 页面通过 window.__installPrompt 读取此事件并展示安装按钮
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as any).__installPrompt = e;
});

// 如果用户已安装，就不反复弹
window.addEventListener('appinstalled', () => {
  (window as any).__installPrompt = null;
});

export default app;
