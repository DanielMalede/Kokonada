/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import {
  friendlyTitle,
  inferSource,
  sourceLabel,
  activityText,
  metaLine,
  relativeTime,
  rowA11yLabel,
  selectHistoryBody,
  JUST_NOW_MS,
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
  WEEKDAY_WINDOW_DAYS,
  SERVER_TITLES,
  RETIRED_ACTIVITY_LABEL,
  GENERIC_TITLE,
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
  // RETIRED under DEC-091 (HX-7, UI-020): this pinned any backend title shown verbatim ('Late night
  // drive'). The server also titles a row by its activity or a title-cased raw key, so a server title
  // is now shown only when it is one of the server's own title words; anything else falls through.
  it('accepts a server title only from the server\'s own words, else the local map, else "A moment"', () => {
    expect(friendlyTitle(item({ title: 'Late night drive', moodKey: 'focus' }))).toBe('Focus');
    expect(friendlyTitle(item({ title: 'Late night drive', moodKey: null }))).toBe('A moment');
  });
  it.each(['Focus', 'Peak Energy', 'Calm', 'Unwind', 'Uplift', 'Intense', 'Resting', 'Active', 'Live'])('shows the server title %j', (t) => {
    expect(friendlyTitle(item({ title: t, moodKey: null }))).toBe(t);
    expect(friendlyTitle(item({ title: `  ${t} `, moodKey: null }))).toBe(t);
  });
  it.each(['Working', 'Running', 'Session', 'Weird Key', 'calm', 'Focus!', 'Late night drive'])(
    'an unknown server title %j renders "A moment" (no moodKey to fall back on)', (t) => {
      expect(friendlyTitle(item({ title: t, moodKey: null }))).toBe('A moment');
    },
  );
  it('the closed set is exactly what the real backend sessionLabel titles its presets, bands and a bare live key', () => {
    // Drift guard: runs the real backend labeller, untransformed (the mobile Babel preset would inject
    // runtime helpers the backend tree cannot resolve). It has no imports; if it gains one, this throws.
    const file = path.resolve(__dirname, '../../../../../../backend/app/services/sessionLabels.js');
    const mod = { exports: {} as any };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: mod, exports: mod.exports }, { filename: file });
    const backend = mod.exports;
    const produced = new Set<string>([
      ...Object.keys(backend.PRESET_TITLES).map((k: string) => backend.sessionLabel(k, null).title),
      ...Object.keys(backend.BAND_TITLES).map((b: string) => backend.sessionLabel(`bio:${b}:unknown`, null).title),
      backend.sessionLabel('bio:', null).title,
    ]);
    expect([...SERVER_TITLES].sort()).toEqual([...produced].sort());
    expect(SERVER_TITLES.size).toBe(9);
    // Installed builds show the server's relabel verbatim; this build shows its own. One word for both.
    expect(backend.RETIRED_ACTIVITY_LABEL).toBe(RETIRED_ACTIVITY_LABEL);
    expect(backend.sessionLabel('energize', 'working').activityLabel).toBe(RETIRED_ACTIVITY_LABEL);
    // BE-016 (the designer's A1): the server titles an erased heart session, and a row with no key or
    // activity, with its general word; installed builds show it verbatim, this build falls back to its
    // own GENERIC_TITLE. One word for both.
    expect(backend.GENERAL_SESSION_TITLE).toBe(GENERIC_TITLE);
    expect(GENERIC_TITLE).toBe('A moment');
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

// HX-7(c), DEC-062: the Working chip is retired, but rows saved with it keep their stored activity (no
// stored-data change). Display relabels them on both render paths: the meta line and the title.
describe('an old Working row is relabelled at display only', () => {
  const working = (over: Partial<SessionItem> = {}) =>
    item({ moodKey: 'energize', source: 'manual', activity: 'working', activityLabel: 'Working', ...over });

  it('the neutral label is the designer\'s word, "General", and names no work or study context', () => {
    expect(RETIRED_ACTIVITY_LABEL).toBe('General');
    expect(RETIRED_ACTIVITY_LABEL).not.toMatch(/work|study|focus|cod|read|office|job/i);
  });
  it('meta line: the raw activity or the server label "Working" reads as the neutral label', () => {
    expect(activityText(working())).toBe(RETIRED_ACTIVITY_LABEL);
    expect(activityText(working({ activityLabel: null }))).toBe(RETIRED_ACTIVITY_LABEL);
    expect(activityText(working({ activity: null }))).toBe(RETIRED_ACTIVITY_LABEL);
    expect(activityText(working({ activity: ' Working ', activityLabel: undefined }))).toBe(RETIRED_ACTIVITY_LABEL);
    expect(metaLine(working())).toBe(`Manual · ${RETIRED_ACTIVITY_LABEL}`);
  });
  it('title: a Working row with no moodKey, which the server titles "Working", reads "A moment"', () => {
    expect(friendlyTitle(working({ moodKey: null, title: 'Working' }))).toBe('A moment');
  });
  it('the spoken row label never says Working', () => {
    const spoken = rowA11yLabel(working({ title: 'Peak Energy' }), new Date('2026-07-03T13:00:00.000Z'));
    expect(spoken).not.toMatch(/working/i);
    expect(spoken).toContain(RETIRED_ACTIVITY_LABEL);
  });
  it('display only: the item itself is never rewritten', () => {
    const row = working();
    metaLine(row); friendlyTitle(row); rowA11yLabel(row);
    expect(row.activity).toBe('working');
    expect(row.activityLabel).toBe('Working');
  });
  it('other chips are untouched', () => {
    expect(activityText(item({ activity: 'running', activityLabel: 'Running' }))).toBe('Running');
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
  it('BE-016: the erased heart-session DTO reads "A moment" over "Live" and speaks it', () => {
    const NOW = new Date(2026, 6, 15, 14, 0, 0);
    const erased = item({ title: 'A moment', source: 'live', moodKey: null, activity: null, activityLabel: null, createdAt: new Date(NOW.getTime() - 5 * MINUTE_MS).toISOString() });
    expect(friendlyTitle(erased)).toBe(GENERIC_TITLE);
    expect(metaLine(erased)).toBe('Live');
    expect(rowA11yLabel(erased, NOW)).toBe('A moment, live session, 5m ago');
  });
});

// The body-state decision, pinned PURE so the flagship empty-flash guard can never silently regress
// behind the mount effect. The two revert-sensitive cases below flip RED the instant the `!hasLoaded`
// first-frame term is deleted from the selector.
describe('selectHistoryBody — the state-machine → body decision', () => {
  it('CASE 1 (flagship): the first frame is a SKELETON, never the empty flash, before the first page resolves', () => {
    // Deleting the `!hasLoaded` term makes this return 'empty' — this assertion is the guard.
    expect(selectHistoryBody({ hasLoaded: false, items: 0, loading: false, refreshing: false, error: null })).toBe('skeleton');
  });

  it('CASE 2: retrying from empty/error (0 items, refreshing) shows the SKELETON, never a re-flashed empty', () => {
    expect(selectHistoryBody({ hasLoaded: true, items: 0, loading: false, refreshing: true, error: null })).toBe('skeleton');
  });

  it('a first-page load still in flight (0 items, loading) stays a skeleton even once hasLoaded flips', () => {
    expect(selectHistoryBody({ hasLoaded: true, items: 0, loading: true, refreshing: false, error: null })).toBe('skeleton');
  });

  it('a first-load error with 0 items is the non-alarm error body', () => {
    expect(selectHistoryBody({ hasLoaded: true, items: 0, loading: false, refreshing: false, error: 'boom' })).toBe('error');
  });

  it('a confirmed-empty response (resolved, 0 items, idle, no error) is the empty body', () => {
    expect(selectHistoryBody({ hasLoaded: true, items: 0, loading: false, refreshing: false, error: null })).toBe('empty');
  });

  it('any loaded items render the list', () => {
    expect(selectHistoryBody({ hasLoaded: true, items: 3, loading: false, refreshing: false, error: null })).toBe('list');
  });

  it('a load-more failure with items present KEEPS the list intact (the footer note carries the error)', () => {
    expect(selectHistoryBody({ hasLoaded: true, items: 3, loading: false, refreshing: false, error: 'boom' })).toBe('list');
  });
});
