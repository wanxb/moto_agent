// fetch 封装：默认带 cookie；遇 401 统一跳 /login（设计 §6：鉴权在 API 层）。

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (res.status === 401 && location.pathname !== '/login') {
    location.href = '/login';
  }
  return res;
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as T;
}

export function postJson(path: string, body: unknown): Promise<Response> {
  return apiFetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// 上传 multipart（语音等）：不设 content-type，由浏览器带 boundary。
export function postForm(path: string, form: FormData): Promise<Response> {
  return apiFetch(path, { method: 'POST', body: form });
}
