import { apiGet, type ApiResult } from '../../net/apiClient';

// Typed client for the GET /api/sessions history feed (A11). Mirrors the backend
// SessionDTO exactly. Cursor pagination: pass the previous page's nextCursor to fetch
// the next. Delegates auth + 401-refresh-retry to apiClient; never throws.

export interface SessionTrack { id: string; title: string; artist: string; }

export interface SessionItem {
  id: string;
  createdAt: string;
  moodKey: string | null;
  // D-3 display fields — optional so pre-D-3 cached rows (or a not-yet-deployed backend)
  // still type-check; HistoryScreen falls back to moodKey/inferred source when absent.
  title?: string;                   // friendly title
  source?: 'manual' | 'live';       // how the playlist was generated
  provider: 'spotify' | 'youtube';
  activity: string | null;
  activityLabel?: string | null;    // friendly chosen-activity label
  contextPrompt: string;
  isFallback: boolean;
  skipCount: number;
  trackCount: number;
  tracks: SessionTrack[];
}

export interface SessionsCursor { before: string; beforeId: string; }

export interface SessionsPage {
  items: SessionItem[];
  nextCursor: SessionsCursor | null;
}

export function fetchSessions(cursor?: SessionsCursor | null, limit = 20): Promise<ApiResult<SessionsPage>> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) {
    params.set('before', cursor.before);
    params.set('beforeId', cursor.beforeId);
  }
  return apiGet<SessionsPage>(`/api/sessions?${params.toString()}`);
}
