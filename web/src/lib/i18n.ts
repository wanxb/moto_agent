// 极简双语：?lang= 优先（并记住），否则 localStorage，默认 zh。

export type Lang = 'zh' | 'en';

const dict: Record<Lang, Record<string, string>> = {
  zh: {
    title: 'Moto Bot',
    input_ph: '输入加油记录…',
    send: '发送',
    dashboard: '仪表盘', logFuel: '记加油', vehicles: '车辆管理', history: '历史',
    empty: '开始记录你的第一次加油吧 ⛽',
    thinking: '思考中…',
    error: '出错了，请稍后再试',
    mic_hold: '按住说话',
    mic_recording: '松开发送',
    mic_denied: '麦克风权限被拒绝',
    transcribing: '识别中…',
    voice_failed: '语音识别失败，请重试',
    login_title: '摩托车油耗管家',
    email_ph: '输入邮箱地址',
    send_link: '发送登录链接',
    login_hint: '我们会发送一封登录邮件，无需密码，无需注册',
    sending: '发送中…',
    sent: '邮件已发送，请检查收件箱 ✉️',
    bad_email: '邮箱格式不对',
    send_failed: '发送失败，请稍后重试',
  },
  en: {
    title: 'Moto Bot',
    input_ph: 'Log a fuel-up…',
    send: 'Send',
    dashboard: 'Dashboard', logFuel: 'Add fuel', vehicles: 'Vehicles', history: 'History',
    empty: 'Log your first fuel-up ⛽',
    thinking: 'Thinking…',
    error: 'Something went wrong, please try again',
    mic_hold: 'Hold to talk',
    mic_recording: 'Release to send',
    mic_denied: 'Microphone permission denied',
    transcribing: 'Transcribing…',
    voice_failed: 'Voice recognition failed, please retry',
    login_title: 'Motorcycle fuel tracker',
    email_ph: 'Enter your email',
    send_link: 'Send magic link',
    login_hint: 'We’ll email you a login link — no password, no signup',
    sending: 'Sending…',
    sent: 'Email sent — check your inbox ✉️',
    bad_email: 'Invalid email',
    send_failed: 'Failed to send, please retry',
  },
};

export function getLang(): Lang {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'zh') { localStorage.setItem('lang', q); return q; }
  return localStorage.getItem('lang') === 'en' ? 'en' : 'zh';
}

export function tr(lang: Lang, key: string): string {
  return dict[lang][key] ?? key;
}
