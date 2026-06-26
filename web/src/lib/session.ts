// 客户端登录态：拉 /api/v1/me。未登录返回 null（不触发 api.ts 的 401 跳转，调用方自行决定）。

export interface Me {
  id: number;
  email: string | null;
  telegram_id: string | null;
  nickname: string | null;
  lang: 'zh' | 'en';
  is_admin: number;
}

export async function getMe(): Promise<Me | null> {
  const res = await fetch('/api/v1/me', { credentials: 'same-origin' });
  if (!res.ok) return null;
  const data = (await res.json()) as { user: Me };
  return data.user;
}
