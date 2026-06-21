export interface SessionTrack {
  id: string;
  title: string;
  artist: string;
  uri: string;
}

export interface Session {
  id: string;
  moodKey: string | null;
  moodLabel: string;
  textPrompt: string;
  mode: 'live' | 'export';
  heartRate: number | null;
  activity: string | null;
  createdAt: number;
  tracks: SessionTrack[];
}

const KEY = 'koko-history';
const CAP = 50;

/** Read the locally-persisted playlist history (most recent first). */
export function getSessions(): Session[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Session[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getSession(id: string): Session | undefined {
  return getSessions().find((s) => s.id === id);
}

/** Prepend a generated session, de-duping identical back-to-back track sets. */
export function saveSession(session: Session): void {
  try {
    const existing = getSessions();
    const sig = session.tracks.map((t) => t.uri).join(',');
    if (existing[0] && existing[0].tracks.map((t) => t.uri).join(',') === sig) return;
    const next = [session, ...existing].slice(0, CAP);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — history is best-effort */
  }
}

export function makeSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
