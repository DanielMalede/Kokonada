import { apiGet, type ApiResult } from '../../net/apiClient';

// Typed client for the GET /api/sessions history feed (A11). Mirrors the backend
// SessionDTO exactly. Cursor pagination: pass the previous page's nextCursor to fetch
// the next. Delegates auth + 401-refresh-retry to apiClient; never throws.

export interface SessionTrack { id: string; title: string; artist: string; }

export interface SessionItem {
  id: string;
  createdAt: string;
  moodKey: string | null;
  provider: 'spotify' | 'youtube';
  activity: string | null;
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
