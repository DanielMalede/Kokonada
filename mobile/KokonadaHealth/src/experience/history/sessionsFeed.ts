import type { ApiResult } from '../../net/apiClient';
import type { SessionItem, SessionsCursor, SessionsPage } from './sessionsApi';

// The paging state machine behind HistoryScreen. Pure (fetch injected), so the tricky
// parts are unit-tested: loadMore is SINGLE-FLIGHT (a frantic scroll fires one request,
// not N), refresh resets to page 1, the end is sticky, and a failure surfaces an error
// without wedging future loads.

export interface SessionsFeedState {
  items: SessionItem[];
  cursor: SessionsCursor | null;
  loading: boolean;
  refreshing: boolean;
  reachedEnd: boolean;
  error: string | null;
}

type FetchPage = (cursor: SessionsCursor | null) => Promise<ApiResult<SessionsPage>>;

const initial: SessionsFeedState = {
  items: [], cursor: null, loading: false, refreshing: false, reachedEnd: false, error: null,
};

export class SessionsFeed {
  private state: SessionsFeedState = { ...initial };

  constructor(
    private readonly fetchPage: FetchPage,
    private readonly onChange: (s: SessionsFeedState) => void = () => {},
  ) {}

  getState(): SessionsFeedState { return this.state; }

  private set(patch: Partial<SessionsFeedState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  // Append the next page. Single-flight (ignored while a load/refresh is in flight)
  // and a no-op once the end is reached.
  async loadMore(): Promise<void> {
    if (this.state.loading || this.state.refreshing || this.state.reachedEnd) return;
    this.set({ loading: true, error: null });
    const res = await this.fetchPage(this.state.cursor);
    if (res.ok) {
      this.set({
        items: [...this.state.items, ...res.data.items],
        cursor: res.data.nextCursor,
        reachedEnd: res.data.nextCursor === null,
        loading: false,
      });
    } else {
      this.set({ loading: false, error: res.error || 'Could not load history' });
    }
  }

  // Pull-to-refresh: reload page 1 from scratch. Single-flight against itself.
  async refresh(): Promise<void> {
    if (this.state.refreshing) return;
    this.set({ refreshing: true, error: null });
    const res = await this.fetchPage(null);
    if (res.ok) {
      this.set({
        items: res.data.items,
        cursor: res.data.nextCursor,
        reachedEnd: res.data.nextCursor === null,
        refreshing: false,
      });
    } else {
      this.set({ refreshing: false, error: res.error || 'Could not refresh history' });
    }
  }
}
