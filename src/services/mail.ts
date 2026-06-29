// 发信服务（spec 016）— Resend 免费层。
// MailChannels 对 Cloudflare Workers 的免费发信已于 2024-08-31 终止（见 ADR-0010），改用 Resend。
// 需 env.RESEND_API_KEY（secret）+ env.SENDER_EMAIL（属于 Resend 已验证域名）。

import type { Env } from '../types';
import { BRAND } from '../brand';

/** 调 Resend 发一封纯文本邮件。失败抛出人类可读错误，由调用方转成用户提示。 */
export async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.SENDER_EMAIL) {
    console.error('[mail] 缺少 RESEND_API_KEY / SENDER_EMAIL 配置');
    throw new Error('邮件服务未配置');
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: `${BRAND.emailFrom} <${env.SENDER_EMAIL}>`,
      to: [to],
      subject,
      text,
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    console.error('[mail] resend send failed:', resp.status, detail);
    throw new Error('邮件发送失败');
  }
}

/** 发登录魔法链接邮件（15 分钟有效）。 */
export async function sendMagicLinkEmail(env: Env, email: string, link: string): Promise<void> {
  await sendEmail(
    env, email, `${BRAND.emailPrefix} 登录链接`,
    `点击以下链接登录${BRAND.nameZh}（15 分钟内有效）：\n\n${link}\n\n如果非本人操作，请忽略此邮件。`,
  );
}

/** 发账号绑定验证链接邮件（10 分钟有效）。点击即把数据并入此邮箱账号。 */
export async function sendBindLinkEmail(env: Env, email: string, link: string): Promise<void> {
  await sendEmail(
    env, email, `🔗 ${BRAND.nameZh} 账号绑定`,
    `点击以下链接完成账号绑定（10 分钟内有效）：\n\n${link}\n\n确认后，你的记录将归入此邮箱账号。\n如果非本人操作，请忽略此邮件。`,
  );
}
