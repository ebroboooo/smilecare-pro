export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Requested-With', 'XMLHttpRequest');
  if (init.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: { error?: { code?: string; message?: string } } | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as { error?: { code?: string; message?: string } };
    } catch {
      throw new ApiError(response.status || 502, 'BAD_RESPONSE', 'The server returned an unexpected response');
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, data?.error?.code || 'HTTP', data?.error?.message || 'Request failed');
  }
  return data as T;
}

export function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
