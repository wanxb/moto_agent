// auto-login token 签名/验证（HMAC-SHA256，零 KV 依赖）。
// TG /dashboard 命令生成签名 token → 拼进链接；浏览器点开 → auth-handler 验证签名 → 登录。
// 密钥 = TELEGRAM_WEBHOOK_SECRET（已有 secret，不新加）。token 5 分钟有效。

async function hmacSign(data: Uint8Array, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function hmacVerify(data: Uint8Array, sig: Uint8Array, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, sig, data);
}

function b64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

const AUTO_LOGIN_TTL = 300;  // 5 分钟

/** TG /dashboard 用：签名 → 自包含 token */
export async function signAutoLoginToken(telegramId: string, secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + AUTO_LOGIN_TTL;
  const payload = `${telegramId}.${exp}`;
  const sig = b64url(await hmacSign(new TextEncoder().encode(payload), secret));
  return `${b64url(new TextEncoder().encode(payload))}.${sig}`;
}

/** auth-handler 用：验证签名 → 返回 telegram_id 或 null */
export async function verifyAutoLoginToken(token: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  try {
    const payload = new TextDecoder().decode(fromB64url(token.slice(0, dot)));
    const sig = fromB64url(token.slice(dot + 1));
    if (!(await hmacVerify(new TextEncoder().encode(payload), sig, secret))) return null;
    const [telegramId, expStr] = payload.split('.');
    const exp = Number(expStr);
    if (!exp || Math.floor(Date.now() / 1000) >= exp) return null;
    return telegramId;
  } catch {
    return null;
  }
}
