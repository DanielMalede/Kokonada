import type { SessionItem } from './sessionsApi';

// §9 History — the light presentation logic, kept PURE so HistoryScreen/HistoryRow stay dumb (D-3).
// Three honest transforms: never surface a raw moodKey (friendly map → warm generic, never "Session"),
// infer Manual/Live truthfully, and speak a calm RELATIVE time (retiring the old verbose toLocaleString).
// The only numeric literals here are the NAMED, exported, unit-tested time thresholds.

export const JUST_NOW_MS = 60 * 1000;           // < 1 min → "Just now" (also swallows small future skew)
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;          // < 1 h → "{n}m ago"
export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEKDAY_WINDOW_DAYS = 7;           // < 7 calendar days → weekday name

export type SourceKind = 'live' | 'manual';

// Deterministic friendly copy for the known moodKey vocabulary (backend moodDescriptors.js):
// six presets + the three synthetic bio heart-rate bands. Anything else → the warm generic.
const MOOD_TITLES: Record<string, string> = {
  focus: 'Focus',
  energize: 'Energize',
  calm: 'Calm',
  unwind: 'Unwind',
  uplift: 'Uplift',
  intense: 'Intense',
};
const BIO_BAND_TITLES: Record<string, string> = {
  resting: 'Resting',
  active: 'Active',
  peak: 'Peak Energy',
};
const GENERIC_TITLE = 'A moment';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Title order: backend friendly title → deterministic moodKey map → warm generic. NEVER the raw key. */
export function friendlyTitle(item: Pick<SessionItem, 'title' | 'moodKey'>): string {
  if (item.title && item.title.trim()) return item.title;
  const key = item.moodKey ?? '';
  if (key.startsWith('bio:')) return BIO_BAND_TITLES[key.split(':')[1] ?? ''] ?? GENERIC_TITLE;
  return MOOD_TITLES[key] ?? GENERIC_TITLE;
}

/** Trust an explicit source; otherwise infer Live from a synthetic bio: key, else Manual. */
export function inferSource(item: Pick<SessionItem, 'source' | 'moodKey'>): SourceKind {
  if (item.source === 'live' || item.source === 'manual') return item.source;
  return (item.moodKey ?? '').startsWith('bio:') ? 'live' : 'manual';
}

export function sourceLabel(source: SourceKind): 'Live' | 'Manual' {
  return source === 'live' ? 'Live' : 'Manual';
}

function humanizeActivity(raw: string): string {
  const s = raw.replace(/[_-]+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** Friendly activity: chosen label → humanized raw activity → null (so the "· …" token drops). */
export function activityText(item: Pick<SessionItem, 'activityLabel' | 'activity'>): string | null {
  if (item.activityLabel && item.activityLabel.trim()) return item.activityLabel;
  if (item.activity && item.activity.trim()) return humanizeActivity(item.activity);
  return null;
}

/** The one meta line under the title: "Live · Running" / "Manual". */
export function metaLine(item: Pick<SessionItem, 'source' | 'moodKey' | 'activityLabel' | 'activity'>): string {
  return [sourceLabel(inferSource(item)), activityText(item)].filter(Boolean).join(' · ');
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Calm relative time. Just now · {n}m ago · Today, HH:MM · Yesterday · {Weekday} · {Mon D} · {Mon D, YYYY}. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const diff = now.getTime() - then.getTime();
  if (diff < JUST_NOW_MS) return 'Just now';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
  const dayDelta = Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS);
  if (dayDelta <= 0) return `Today, ${pad2(then.getHours())}:${pad2(then.getMinutes())}`;
  if (dayDelta === 1) return 'Yesterday';
  if (dayDelta < WEEKDAY_WINDOW_DAYS) return WEEKDAYS[then.getDay()];
  const md = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === now.getFullYear() ? md : `${md}, ${then.getFullYear()}`;
}

/** One composed spoken sentence for the row button — friendly title, never the raw key. */
export function rowA11yLabel(
  item: Pick<SessionItem, 'title' | 'moodKey' | 'source' | 'activityLabel' | 'activity' | 'createdAt'>,
  now: Date = new Date(),
): string {
  const parts = [
    friendlyTitle(item),
    `${inferSource(item)} session`,
    activityText(item),
    relativeTime(item.createdAt, now),
  ].filter(Boolean);
  return parts.join(', ');
}
