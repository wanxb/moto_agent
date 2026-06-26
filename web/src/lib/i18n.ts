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
    days_unit: '天',
    fuel_records: '⛽ 加油记录', maint_records: '🔧 维保记录', reminders_h: '🔔 提醒事项',
    col_date: '日期', col_grade: '油号', col_price: '单价', col_liters: '加油量', col_cost: '金额', col_odo: '里程',
    no_fuel: '暂无加油记录', no_maint: '暂无维保记录', no_rem: '暂无提醒事项', no_vehicles: '暂无车辆，请先在 Bot 或对话中添加',
    avg_consumption: '平均油耗', total_liters: '总油量', total_cost: '总费用', total_km: '总里程',
    chart_volume: '加油量 (L)', chart_cost: '费用 (¥)', chart_consumption: '油耗 (L/100km)', l_per_100: 'L/100km',
    dash_loading: '加载中…', dash_load_failed: '加载失败',
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
    days_unit: 'd',
    fuel_records: '⛽ Fuel Records', maint_records: '🔧 Maintenance', reminders_h: '🔔 Reminders',
    col_date: 'Date', col_grade: 'Grade', col_price: 'Price/L', col_liters: 'Liters', col_cost: 'Cost', col_odo: 'Odo',
    no_fuel: 'No fuel records', no_maint: 'No maintenance records', no_rem: 'No reminders', no_vehicles: 'No vehicles — add one in the bot or chat first',
    avg_consumption: 'Avg Fuel', total_liters: 'Total Vol', total_cost: 'Total Cost', total_km: 'Total Odo',
    chart_volume: 'Volume (L)', chart_cost: 'Cost (¥)', chart_consumption: 'Consumption (L/100km)', l_per_100: 'L/100km',
    dash_loading: 'Loading…', dash_load_failed: 'Load failed',
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
