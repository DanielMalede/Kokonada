// QA-047: a scriptable fake API. It is a fetch-shaped function (inject it as ApiClientDeps.fetchImpl,
// or as global fetch) that answers each scripted route with the status, body, latency or failure the
// test chose, logs every request, and counts the ones still in flight. Latency runs on timers, so the
// fake clock (clock.ts) decides when an answer lands; with no latency, an answer still arrives
// asynchronously, as fetch's does. An unscripted request rejects loudly instead of answering.
// Response headers are scripted per answer and read case-insensitively, as fetch's Headers are.

type Kind = 'reply' | 'network' | 'malformed' | 'never';
type ScriptedHeaders = Record<string, string>;
interface Script { kind: Kind; status: number; body?: unknown; latencyMs?: number; headers?: ScriptedHeaders }
interface AnswerOptions { latencyMs?: number; headers?: ScriptedHeaders }

/** The read side of fetch's Headers: names match case-insensitively; an absent header is null. */
function responseHeaders(scripted: ScriptedHeaders = {}) {
  const byName = new Map(Object.entries(scripted).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    get: (name: string): string | null => byName.get(name.toLowerCase()) ?? null,
    has: (name: string): boolean => byName.has(name.toLowerCase()),
  };
}

export interface LoggedRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  at: number;
}

const pathOf = (url: string) => url.replace(/^[a-z]+:\/\/[^/]+/i, '');
const withoutQuery = (path: string) => path.split('?')[0];

export class FakeRoute {
  private scripts: Script[] = [];

  constructor(readonly method: string, readonly matcher: string | RegExp) {}

  matches(method: string, path: string): boolean {
    if (method !== this.method) return false;
    return typeof this.matcher === 'string' ? withoutQuery(path) === this.matcher : this.matcher.test(path);
  }

  /** Answer with status, body and headers (after latencyMs). Chained calls answer successive requests; the last repeats. */
  reply(status: number, body?: unknown, options: AnswerOptions = {}): this {
    this.scripts.push({ kind: 'reply', status, body, latencyMs: options.latencyMs, headers: options.headers });
    return this;
  }

  /** Successive answers, one per request (the last repeats). */
  replies(list: Array<{ status: number; body?: unknown } & AnswerOptions>): this {
    for (const r of list) this.reply(r.status, r.body, { latencyMs: r.latencyMs, headers: r.headers });
    return this;
  }

  /** fetch rejects (airplane mode, DNS, TLS), after latencyMs. */
  networkError(options: { latencyMs?: number } = {}): this {
    this.scripts.push({ kind: 'network', status: 0, latencyMs: options.latencyMs });
    return this;
  }

  /** A response whose body is not JSON. */
  malformedJson(status = 200, options: AnswerOptions = {}): this {
    this.scripts.push({ kind: 'malformed', status, latencyMs: options.latencyMs, headers: options.headers });
    return this;
  }

  /** A request that never settles. */
  never(): this {
    this.scripts.push({ kind: 'never', status: 0 });
    return this;
  }

  /** @internal */
  take(): Script {
    if (this.scripts.length === 0) throw new Error(`FakeApi: ${this.method} ${String(this.matcher)} has no answer scripted`);
    return this.scripts.length > 1 ? this.scripts.shift()! : this.scripts[0];
  }
}

export class FakeApi {
  readonly log: LoggedRequest[] = [];
  private routes: FakeRoute[] = [];
  private inFlight = 0;

  on(method: string, path: string | RegExp): FakeRoute {
    const route = new FakeRoute(method.toUpperCase(), path);
    this.routes.push(route);
    return route;
  }

  pending(): number {
    return this.inFlight;
  }

  /** fetch's own type, so it drops into ApiClientDeps.fetchImpl or global fetch unchanged. */
  readonly fetch: typeof fetch = ((input: string | { url: string }, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<any> => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    const path = pathOf(url);
    let body: unknown = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep the raw string */ } }
    this.log.push({ method, url, path, headers: { ...(init.headers ?? {}) }, body, at: Date.now() });
    const route = [...this.routes].reverse().find((r) => r.matches(method, path));
    if (!route) return Promise.reject(new Error(`FakeApi: unscripted request ${method} ${path}`));
    const script = route.take();
    this.inFlight += 1;
    return new Promise((resolve, reject) => {
      if (script.kind === 'never') return;
      const settle = () => {
        this.inFlight -= 1;
        if (script.kind === 'network') { reject(new TypeError('Network request failed')); return; }
        const status = script.status;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          headers: responseHeaders(script.headers),
          json: async () => {
            if (script.kind === 'malformed') throw new SyntaxError('Unexpected token < in JSON at position 0');
            return script.body;
          },
          text: async () => (script.kind === 'malformed' ? '<html>' : JSON.stringify(script.body ?? null)),
        });
      };
      if (script.latencyMs && script.latencyMs > 0) setTimeout(settle, script.latencyMs);
      else void Promise.resolve().then(settle);
    });
  }) as unknown as typeof fetch;
}

/** The same request again: method, path and body equal (headers may carry a refreshed token). */
export function sameRequest(a: LoggedRequest, b: LoggedRequest): boolean {
  return a.method === b.method && a.path === b.path && JSON.stringify(a.body) === JSON.stringify(b.body);
}
