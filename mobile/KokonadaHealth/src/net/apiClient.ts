import { authSession } from '../auth/session';
import { BACKEND_URL } from '../health/config';

// The one authenticated REST surface for the app. Reads the access token from the
// single AuthSession plane (QA4 Suspect #1), and on a 401 performs a refresh —
// which is single-flight inside AuthSession, so concurrent 401s collapse into ONE
// rotation — then retries exactly once. Never throws: a network failure, an error
// status, or an unparseable body all become a typed {ok:false} result the UI can
// render without a try/catch.

// C1: `sessionKept` marks a 401 whose refresh could not get a verdict (the server unreachable, a 5xx, a
// 429, inside the hold) while the session is still held: the caller keeps the person signed in.
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status?: number; sessionKept?: true; error: string };

type Method = 'GET' | 'POST' | 'DELETE' | 'PUT';

// C1: the parts of the session the 401 path reads. Optional, so a client built without it answers as v1.
export interface ApiClientSession {
  hasSession(): boolean;
  sessionEpoch(): number;
  endAsDead(opts: { onlyIfEpoch?: number }): Promise<boolean>;
}

export interface ApiClientDeps {
  baseUrl: string;
  getAccessToken: () => string | null;
  refresh: () => Promise<string | null>;
  session?: ApiClientSession;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

// C1 (RA-7's REST half): RN's fetch has no deadline (RN's Android OkHttp client is built with 0 ms
// timeouts) and AbortSignal.timeout is not on Hermes, so a request the network never answered never
// settled. Each attempt, its body included, is aborted after REQUEST_TIMEOUT_MS and settles then as a
// network error even if the fetch ignores the abort. A timeout is no verdict on the session.
const REQUEST_TIMEOUT_MS = 15_000;

class Timeout extends Error {}

async function withDeadline<R>(ms: number, run: (signal: AbortSignal) => Promise<R>): Promise<R> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Timeout('request timed out')); }, ms);
  });
  try {
    return await Promise.race([run(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// The auth middleware's 401s carry no `code` (backend/app/middleware/auth.js); a route that answers 401
// for its own reason names one (integrationsController getSpotifyToken: `reconnect_required`).
const routeCode = (body: unknown): boolean =>
  body !== null && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string';

export class ApiClient {
  constructor(private readonly deps: ApiClientDeps) {}

  get<T>(path: string): Promise<ApiResult<T>> { return this.request<T>('GET', path); }
  delete<T>(path: string): Promise<ApiResult<T>> { return this.request<T>('DELETE', path); }
  post<T>(path: string, body?: unknown): Promise<ApiResult<T>> { return this.request<T>('POST', path, body); }

  private async request<T>(method: Method, path: string, body?: unknown): Promise<ApiResult<T>> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const url = `${this.deps.baseUrl}${path}`;
    const timeoutMs = this.deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const session = this.deps.session;
    type Attempt = { status: number; ok: boolean; read: () => Promise<{ parsed: boolean; data: unknown }> };

    // One attempt, bounded end to end: the response and, when it is read, its body.
    const attempt = (token: string | null, retried = false): Promise<Attempt | 'network'> => withDeadline(timeoutMs, async (signal) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
      let read: Promise<{ parsed: boolean; data: unknown }> | null = null;
      const readOnce = () => {
        read ??= Promise.resolve().then(() => res.json()).then((data) => ({ parsed: true, data }), () => ({ parsed: false, data: undefined }));
        return read;
      };
      if (res.ok || (retried && res.status === 401)) await readOnce(); // inside the deadline
      return { status: res.status, ok: res.ok, read: readOnce };
    }).catch(() => 'network' as const);

    let res = await attempt(this.deps.getAccessToken());
    if (res === 'network') return { ok: false, error: 'network error' };

    if (res.status === 401) {
      const epoch = session?.sessionEpoch();
      const fresh = await this.deps.refresh();
      if (!fresh) {
        return session?.hasSession()
          ? { ok: false, status: 401, sessionKept: true, error: 'unauthorized' }
          : { ok: false, status: 401, error: 'unauthorized' };
      }
      res = await attempt(fresh, true);
      if (res === 'network') return { ok: false, error: 'network error' };
      // C1: the server refused the token it has just issued, so the session is dead. Scoped to the
      // session that rotated it, and never on a route's own 401.
      if (res.status === 401 && session && epoch !== undefined && !routeCode((await res.read()).data)) {
        await session.endAsDead({ onlyIfEpoch: epoch });
        return { ok: false, status: 401, error: 'unauthorized' };
      }
    }

    if (!res.ok) return { ok: false, status: res.status, error: `request failed (${res.status})` };

    const answer = await res.read();
    return answer.parsed ? { ok: true, data: answer.data as T } : { ok: false, error: 'invalid response body' };
  }
}

// Production singleton, bound to the app's AuthSession token plane.
export const apiClient = new ApiClient({
  baseUrl: BACKEND_URL,
  getAccessToken: () => authSession.getAccessToken(),
  refresh: () => authSession.refresh(),
  session: authSession,
});

export const apiGet = <T>(path: string) => apiClient.get<T>(path);
export const apiPost = <T>(path: string, body?: unknown) => apiClient.post<T>(path, body);
export const apiDelete = <T>(path: string) => apiClient.delete<T>(path);
