import {
  friendlyTitle,
  inferSource,
  sourceLabel,
  activityText,
  metaLine,
  relativeTime,
  rowA11yLabel,
  JUST_NOW_MS,
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
  WEEKDAY_WINDOW_DAYS,
} from '../historyFormat';
import type { SessionItem } from '../sessionsApi';

// History's LIGHT LOGIC (§9 D-3), pinned pure so the presentation can stay dumb: never expose a raw
// moodKey (friendly map → warm generic "A moment", never "Session"), infer Manual/Live honestly, and
// speak a calm RELATIVE time (never the old verbose toLocaleString). All thresholds are named + tested.

const item = (over: Partial<SessionItem> = {}): SessionItem => ({
  id: 'x', createdAt: '2026-07-03T12:00:00.000Z', moodKey: null, provider: 'spotify',
  activity: null, contextPrompt: '', isFallback: false, skipCount: 0, trackCount: 1,
  tracks: [{ id: 't1', title: 'Song', artist: 'Artist' }], ...over,
});

describe('named thresholds (the only allowed magic numbers, exported + pinned)', () => {
  it('are the calm relative-time boundaries', () => {
    expect(JUST_NOW_MS).toBe(60 * 1000);
    expect(MINUTE_MS).toBe(60 * 1000);
    expect(HOUR_MS).toBe(60 * 60 * 1000);
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000);
    expect(WEEKDAY_WINDOW_DAYS).toBe(7);
  });
});

describe('friendlyTitle — never a raw moodKey', () => {
  it('prefers the backend-supplied friendly title verbatim', () => {
    expect(friendlyTitle(item({ title: 'Late night drive', moodKey: 'focus' }))).toBe('Late night drive');
  });
  it('ignores a blank title and maps a preset moodKey to a friendly word', () => {
    expect(friendlyTitle(item({ title: '   ', moodKey: 'focus' }))).toBe('Focus');
    expect(friendlyTitle(item({ moodKey: 'calm' }))).toBe('Calm');
    expect(friendlyTitle(item({ moodKey: 'energize' }))).toBe('Energize');
  });
  it('maps a synthetic bio:<band>:<activity> key to its band title (spec a11y example)', () => {
    expect(friendlyTitle(item({ moodKey: 'bio:peak:running' }))).toBe('Peak Energy');
    expect(friendlyTitle(item({ moodKey: 'bio:resting:unknown' }))).toBe('Resting');
    expect(friendlyTitle(item({ moodKey: 'bio:active:cycling' }))).toBe('Active');
  });
  it('falls back to a warm generic "A moment" — never the raw key, never "Session"', () => {
    expect(friendlyTitle(item({ moodKey: 'some_unknown_key' }))).toBe('A moment');
    expect(friendlyTitle(item({ moodKey: null }))).toBe('A moment');
    // The raw key must NEVER leak as the title.
    expect(friendlyTitle(item({ moodKey: 'focus' }))).not.toBe('focus');
    expect(friendlyTitle(item({ moodKey: 'bio:peak:running' }))).not.toContain('bio:');
  });
});

describe('inferSource / sourceLabel — honest Manual vs Live', () => {
  it('trusts an explicit source', () => {
    expect(inferSource(item({ source: 'live', moodKey: null }))).toBe('live');
    expect(inferSource(item({ source: 'manual', moodKey: 'bio:peak:running' }))).toBe('manual');
  });
  it('infers Live from a bio: key and Manual otherwise', () => {
    expect(inferSource(item({ moodKey: 'bio:resting:unknown' }))).toBe('live');
    expect(inferSource(item({ moodKey: 'focus' }))).toBe('manual');
    expect(inferSource(item({ moodKey: null }))).toBe('manual');
  });
  it('spells the source as a human word', () => {
    expect(sourceLabel('live')).toBe('Live');
    expect(sourceLabel('manual')).toBe('Manual');
  });
});

describe('activityText / metaLine', () => {
  it('prefers a friendly activityLabel, else humanizes the raw activity, else drops it', () => {
    expect(activityText(item({ activityLabel: 'Trail run' }))).toBe('Trail run');
    expect(activityText(item({ activity: 'running' }))).toBe('Running');
    expect(activityText(item({ activity: 'weight_training' }))).toBe('Weight training');
    expect(activityText(item({ activity: null }))).toBeNull();
    expect(activityText(item({ activityLabel: '  ', activity: null }))).toBeNull();
  });
  it('joins source + activity into the calm meta line', () => {
    expect(metaLine(item({ source: 'live', activity: 'running' }))).toBe('Live · Running');
    expect(metaLine(item({ source: 'manual', activity: null }))).toBe('Manual');
  });
});

describe('relativeTime — calm relative clock (never toLocaleString)', () => {
  const NOW = new Date(2026, 6, 15, 14, 0, 0); // local Wed Jul 15 2026, 14:00
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  it('returns empty string for an unparseable timestamp', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('');
  });
  it('under a minute (and small future clock skew) reads "Just now"', () => {
    expect(relativeTime(ago(30 * 1000), NOW)).toBe('Just now');
    expect(relativeTime(new Date(NOW.getTime() + 30 * 1000).toISOString(), NOW)).toBe('Just now');
  });
  it('under an hour reads "{n}m ago"', () => {
    expect(relativeTime(ago(5 * MINUTE_MS), NOW)).toBe('5m ago');
    expect(relativeTime(ago(59 * MINUTE_MS), NOW)).toBe('59m ago');
  });
  it('same calendar day (≥1h) reads "Today, HH:MM" (zero-padded 24h)', () => {
    const t = new Date(2026, 6, 15, 9, 5, 0).toISOString();
    expect(relativeTime(t, NOW)).toBe('Today, 09:05');
  });
  it('previous calendar day reads "Yesterday"', () => {
    expect(relativeTime(new Date(2026, 6, 14, 20, 0, 0).toISOString(), NOW)).toBe('Yesterday');
  });
  it('within the week window reads the weekday name', () => {
    const d = new Date(2026, 6, 12, 14, 0, 0); // 3 days prior
    expect(relativeTime(d.toISOString(), NOW)).toBe(WEEKDAYS[d.getDay()]);
  });
  it('same year but older reads "Mon D"', () => {
    expect(relativeTime(new Date(2026, 6, 5, 14, 0, 0).toISOString(), NOW)).toBe('Jul 5');
  });
  it('a prior year reads "Mon D, YYYY"', () => {
    expect(relativeTime(new Date(2025, 6, 5, 14, 0, 0).toISOString(), NOW)).toBe('Jul 5, 2025');
  });
});

describe('rowA11yLabel — one composed spoken sentence (friendly title, never the raw key)', () => {
  it('composes friendly title + spoken source + activity + spoken time', () => {
    const NOW = new Date(2026, 6, 15, 14, 0, 0);
    const it0 = item({ moodKey: 'bio:peak:running', activity: 'running', createdAt: new Date(NOW.getTime() - 5 * MINUTE_MS).toISOString() });
    expect(rowA11yLabel(it0, NOW)).toBe('Peak Energy, live session, Running, 5m ago');
  });
});
