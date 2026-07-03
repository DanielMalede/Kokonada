import { authSession } from '../auth/session';
import { BACKEND_URL } from '../health/config';

// The one authenticated REST surface for the app. Reads the access token from the
// single AuthSession plane (QA4 Suspect #1), and on a 401 performs a refresh —
// which is single-flight inside AuthSession, so concurrent 401s collapse into ONE
// rotation — then retries exactly once. Never throws: a network failure, an error
// status, or an unparseable body all become a typed {ok:false} result the UI can
// render without a try/catch.

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status?: number; error: string };

type Method = 'GET' | 'POST' | 'DELETE' | 'PUT';

export interface ApiClientDeps {
  baseUrl: string;
  getAccessToken: () => string | null;
  refresh: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  constructor(private readonly deps: ApiClientDeps) {}

  get<T>(path: string): Promise<ApiResult<T>> { return this.request<T>('GET', path); }
  delete<T>(path: string): Promise<ApiResult<T>> { return this.request<T>('DELETE', path); }
  post<T>(path: string, body?: unknown): Promise<ApiResult<T>> { return this.request<T>('POST', path, body); }

  private async request<T>(method: Method, path: string, body?: unknown): Promise<ApiResult<T>> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const url = `${this.deps.baseUrl}${path}`;
    const send = (token: string | null) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      return fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    };

    let res: Awaited<ReturnType<typeof fetchImpl>>;
    try {
      res = await send(this.deps.getAccessToken());
    } catch {
      return { ok: false, error: 'network error' };
    }

    if (res.status === 401) {
      const fresh = await this.deps.refresh();
      if (!fresh) return { ok: false, status: 401, error: 'unauthorized' };
      try {
        res = await send(fresh);
      } catch {
        return { ok: false, error: 'network error' };
      }
    }

    if (!res.ok) return { ok: false, status: res.status, error: `request failed (${res.status})` };

    try {
      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch {
      return { ok: false, error: 'invalid response body' };
    }
  }
}

// Production singleton, bound to the app's AuthSession token plane.
export const apiClient = new ApiClient({
  baseUrl: BACKEND_URL,
  getAccessToken: () => authSession.getAccessToken(),
  refresh: () => authSession.refresh(),
});

export const apiGet = <T>(path: string) => apiClient.get<T>(path);
export const apiPost = <T>(path: string, body?: unknown) => apiClient.post<T>(path, body);
export const apiDelete = <T>(path: string) => apiClient.delete<T>(path);
