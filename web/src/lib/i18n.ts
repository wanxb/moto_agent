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
    settings_title: '设置',
    back: '返回',
    account: '账号',
    email_label: '邮箱',
    not_set: '未设置',
    language: '语言',
    tg_status: 'Telegram 绑定',
    bound: '已绑定',
    not_bound: '未绑定',
    bind_title: '绑定 Telegram',
    bind_help: '在 Telegram 给 Bot 发送 “/bind 你的邮箱”，再在此输入收到的 6 位验证码。',
    code_ph: '6 位验证码',
    bind_btn: '绑定',
    bind_ok: '✅ 绑定成功',
    bind_fail: '绑定失败，请检查验证码是否正确或过期',
    unbind_hint: '如需解绑请联系管理员（暂未开放自助解绑）',
    logout: '退出登录',
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
    settings_title: 'Settings',
    back: 'Back',
    account: 'Account',
    email_label: 'Email',
    not_set: 'Not set',
    language: 'Language',
    tg_status: 'Telegram',
    bound: 'Bound',
    not_bound: 'Not bound',
    bind_title: 'Bind Telegram',
    bind_help: 'In Telegram, send “/bind your@email” to the bot, then enter the 6-digit code here.',
    code_ph: '6-digit code',
    bind_btn: 'Bind',
    bind_ok: '✅ Bound successfully',
    bind_fail: 'Binding failed — check the code is correct and not expired',
    unbind_hint: 'To unbind, contact the admin (self-service unbind not available yet)',
    logout: 'Log out',
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

// 切换 UI 语言：写 localStorage（getLang 下次读到）。DB 持久化由调用方另发 POST /api/v1/me。
export function setLang(lang: Lang): void {
  localStorage.setItem('lang', lang);
}

export function tr(lang: Lang, key: string): string {
  return dict[lang][key] ?? key;
}
