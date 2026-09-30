import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.setTimeout(20000); // cold-require headroom for CI 4-core starvation (same as ProfileScreen, #105)

// Production wraps the app in a SafeAreaProvider; supply one (zero insets) so the safe-area
// chrome reads its insets in the headless renderer.
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

jest.mock('../pulseStateStore', () => {
  const { createStore } = require('zustand/vanilla');
  const refresh = jest.fn();
  const store = createStore(() => ({ data: null, loading: false, fetchedAt: null, refresh }));
  return { pulseStateStore: store };
});

// The last sync's per-type counts drive the honest gauge sentences (#90). Mutable so a test
// can model "watch shared restingHR/sleep but not HRV" and assert the right sentence per gauge.
let mockSyncCounts: any = null;
const mockCountsUnsub = jest.fn();
jest.mock('../../../health/healthSync', () => ({
  getLastSyncCounts: () => mockSyncCounts,
  subscribeSyncCounts: () => mockCountsUnsub,
}));

// useFocusEffect needs a navigation context; mock it to run the effect on mount and expose the
// callback so a test can simulate returning to the tab (re-focus → re-fetch). useNavigation is
// mocked to a spy so the honest empty-state CTA's destination can be asserted.
let mockFocusCb: null | (() => void) = null;
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: (name: string) => mockNavigate(name) }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    mockFocusCb = cb;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { cb(); }, []); // run once on mount, mimicking a first focus
  },
}));

import * as RN from 'react-native';
import { PulseScreen } from '../PulseScreen';
import { pulseStateStore } from '../pulseStateStore';
import { warmStore } from '../../../state/store';
import { colors, space, radius, type ThemeName } from '../../../design/tokens';
import { textScrimFill } from '../../../design/auroraSurfaces';
import { AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER, MEDICAL_CONSULT_REMINDER } from '../../../legal/legalCopy';
import { LegalNote } from '../../../legal/LegalNote';
import { STATE_LABEL_HIGH_ACTIVATION, STATE_LABEL_FALLBACK } from '../stateDisplayVocabulary';

const mockRefresh = pulseStateStore.getState().refresh as jest.Mock;

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
const allText = (tree: ReactTestRenderer.ReactTestRenderer) => texts(tree.toJSON()).join(' ');
const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label);

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <PulseScreen />
      </SafeAreaProvider>,
    );
  });
  return tree;
}

const withData = (over: any = {}) => ({
  data: {
    stateVector: { status: 'Peak Athletic Performance', confidence: 0.9, computedAt: null },
    vitals: { hrv: 48, bodyBattery: 74, dailyReadiness: 81, restingHeartRate: 54 },
    sleep: { lastNight: { deep: 90, light: 280, rem: 85, date: null }, updatedAt: null },
    lastAnalyzed: null, sampleCount: 4200,
    ...over,
  },
  loading: false,
});

afterEach(() => {
  warmStore.getState().reset();
  pulseStateStore.setState({ data: null, loading: false } as any);
  mockSyncCounts = null;
  mockFocusCb = null;
  jest.clearAllMocks();
});

describe('PulseScreen — sacred pipeline wiring (unchanged by the reskin)', () => {
  it('fetches the state vector on mount', async () => {
    const tree = await render();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('re-fetches on every tab focus, not just first mount (stale-after-sync fix)', async () => {
    const tree = await render();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { mockFocusCb?.(); });
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('unsubscribes from both stores AND sync-counts on unmount (no leaked closure)', async () => {
    let subs = 0; let unsubs = 0;
    const realW = warmStore.subscribe.bind(warmStore);
    const realP = pulseStateStore.subscribe.bind(pulseStateStore);
    const w = jest.spyOn(warmStore, 'subscribe').mockImplementation((cb: any) => { subs++; const u = realW(cb); return () => { unsubs++; u(); }; });
    const p = jest.spyOn(pulseStateStore, 'subscribe').mockImplementation((cb: any) => { subs++; const u = realP(cb); return () => { unsubs++; u(); }; });
    const tree = await render();
    expect(mockCountsUnsub).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    w.mockRestore(); p.mockRestore();
    expect(subs).toBe(2);
    expect(unsubs).toBe(2);
    expect(mockCountsUnsub).toHaveBeenCalledTimes(1); // the sync-counts unsub fired too (setCounts closure freed)
  });

  it('shows the live warm-store HR', async () => {
    await ReactTestRenderer.act(async () => { warmStore.getState().setLiveHr(77); });
    const tree = await render();
    expect(allText(tree)).toContain('77');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('PulseScreen — honest-empty language (NEVER a bare dash)', () => {
  it('renders the whole-screen empty state when the body is not in the picture', async () => {
    // source none, no live HR, no data, no sync evidence → EmptyState, not a dashboard of dashes.
    const tree = await render();
    const t = allText(tree);
    expect(t).toContain("Your body isn't in the picture yet");
    expect(t).toContain('Connect a device');
    expect(texts(tree.toJSON()).some((s) => s === '—')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the empty-state CTA routes to the in-app connect surface', async () => {
    const tree = await render();
    const cta = byLabel(tree, 'Connect a device').find((n) => typeof n.props.onPress === 'function');
    await ReactTestRenderer.act(async () => { cta!.props.onPress(); });
    expect(mockNavigate).toHaveBeenCalledWith('Profile');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('gives an honest per-metric SENTENCE, never a dash (#90 / D-4b)', async () => {
    // The watch shared resting-HR + sleep but no HRV; none reached the profile (vitals null).
    mockSyncCounts = { heartRate: 14087, hrv: 0, sleep: 53, restingHeartRate: 18 };
    const tree = await render();
    const t = allText(tree);
    expect(t).toContain('Not shared by your watch'); // HRV: genuinely absent (read 0)
    expect(t).toContain('Not in your profile yet — pull to refresh'); // Resting HR / sleep: read, not ingested
    expect(t).toContain('Garmin-only'); // Body Battery / Readiness: source-truth
    expect(t).toContain('Not shared by Health Connect');
    expect(t).not.toContain('re-sync'); // the retired copy
    expect(texts(tree.toJSON()).some((s) => s === '—')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a Garmin-only gauge NEVER offers a try-again, even with a live Health Connect source', async () => {
    await ReactTestRenderer.act(async () => { warmStore.getState().setBiometricSource('health-connect'); });
    mockSyncCounts = { heartRate: 1, hrv: 1, sleep: 1, restingHeartRate: 1 };
    // vitals present but bodyBattery/dailyReadiness null (the Garmin-proprietary gap).
    await ReactTestRenderer.act(async () => {
      pulseStateStore.setState(withData({ vitals: { hrv: 48, bodyBattery: null, dailyReadiness: null, restingHeartRate: 54 } }) as any);
    });
    const tree = await render();
    const bb = byLabel(tree, 'Body Battery, Garmin-only, Not shared by Health Connect');
    expect(bb.length).toBeGreaterThan(0);
    expect(bb[0].props.accessibilityLabel).not.toMatch(/sync|refresh|try again/i);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('PulseScreen — dashboard values, gauges and state headline', () => {
  it('renders vitals + status when data is present (no dash anywhere)', async () => {
    await ReactTestRenderer.act(async () => { pulseStateStore.setState(withData() as any); });
    const tree = await render();
    const t = allText(tree);
    expect(t).toContain('Peak Athletic Performance');
    expect(t).toContain('48'); // HRV
    expect(t).toContain('90'); // deep sleep
    // RETIRED under DEC-091 (HX-7, CMP-086): this pinned "90% read confidence". A percentage on an
    // inferred state is a precision claim the read cannot back, so nothing takes its place.
    expect(t).not.toMatch(/%|confidence|accura/i);
    expect(texts(tree.toJSON()).some((s) => s === '—')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('keeps good numbers visible while refreshing (stale-while-revalidate, never a skeleton takeover)', async () => {
    // A refresh over existing data is data-present + loading:true. isSyncing guards on data == null,
    // so the good gauges stay — dropping that term would blank them into skeletons on every pull.
    await ReactTestRenderer.act(async () => { pulseStateStore.setState({ ...withData(), loading: true } as any); });
    const tree = await render();
    const t = allText(tree);
    expect(t).toContain('48'); // HRV still shown
    expect(t).toContain('90'); // deep sleep still shown
    expect(byLabel(tree, 'Reading your body…').length).toBe(0); // no skeleton takeover on refresh
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a gauge announces value + FULL-WORD unit', async () => {
    await ReactTestRenderer.act(async () => { pulseStateStore.setState(withData() as any); });
    const tree = await render();
    expect(byLabel(tree, 'HRV, 48 milliseconds').length).toBeGreaterThan(0);
    expect(byLabel(tree, 'Resting HR, 54 beats per minute').length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the HR hero reads value + full-word unit + live, and is NOT a live region', async () => {
    await ReactTestRenderer.act(async () => { warmStore.getState().setLiveHr(62); });
    await ReactTestRenderer.act(async () => { pulseStateStore.setState(withData() as any); });
    const tree = await render();
    const hero = byLabel(tree, 'Heart rate, 62 beats per minute, live');
    expect(hero.length).toBeGreaterThan(0);
    // updates too often to be a live region — must not spam a screen reader.
    expect(hero.every((n) => n.props.accessibilityLiveRegion == null || n.props.accessibilityLiveRegion === 'none')).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a Health Connect reading is spoken as "from Health Connect", never "live" (it is a synced read)', async () => {
    await ReactTestRenderer.act(async () => {
      warmStore.getState().setBiometricSource('health-connect');
      warmStore.getState().setLiveHr(62);
    });
    const tree = await render();
    expect(byLabel(tree, 'Heart rate, 62 beats per minute, from Health Connect').length).toBeGreaterThan(0);
    expect(byLabel(tree, 'Heart rate, 62 beats per minute, live')).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a heart-rate sensor reading stays "live"', async () => {
    await ReactTestRenderer.act(async () => {
      warmStore.getState().setBiometricSource('ble');
      warmStore.getState().setLiveHr(62);
    });
    const tree = await render();
    expect(byLabel(tree, 'Heart rate, 62 beats per minute, live').length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  // HX-7 design + compliance: the socket chip reports the server connection, not the body read, so it
  // never says "Live" (a Health Connect read is synced, not live). Connecting/Offline are unchanged.
  it.each([
    ['connected', 'Connected'],
    ['connecting', 'Connecting…'],
    ['disconnected', 'Offline'],
  ] as const)('the socket chip for %s reads %j, and no chip says "Live"', async (status, text) => {
    await ReactTestRenderer.act(async () => {
      warmStore.getState().setConnection(status);
      pulseStateStore.setState(withData() as any);
    });
    const tree = await render();
    expect(byLabel(tree, text).length).toBeGreaterThan(0);
    expect(byLabel(tree, 'Live')).toHaveLength(0);
    expect(texts(tree.toJSON())).not.toContain('Live');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('no live HR → an honest hushed reading, never a dash', async () => {
    await ReactTestRenderer.act(async () => { pulseStateStore.setState(withData() as any); });
    const tree = await render();
    expect(allText(tree)).toContain('No live reading');
    expect(byLabel(tree, 'Heart rate, no live reading').length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the state headline is a header', async () => {
    await ReactTestRenderer.act(async () => { pulseStateStore.setState(withData() as any); });
    const tree = await render();
    const headers = tree.root.findAll((n) => n.props.accessibilityRole === 'header');
    expect(headers.some((h) => texts(h.props.children).join(' ').includes('Peak Athletic Performance'))).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a null state does not vanish — it shows a calm placeholder', async () => {
    await ReactTestRenderer.act(async () => {
      pulseStateStore.setState(withData({ stateVector: { status: null, confidence: null, computedAt: null } }) as any);
    });
    const tree = await render();
    expect(allText(tree)).toContain("Your state will appear once your body's being read");
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('PulseScreen — syncing first-load (skeletons never spinners)', () => {
  it('announces the load and shows no dash while syncing', async () => {
    await ReactTestRenderer.act(async () => { pulseStateStore.setState({ data: null, loading: true } as any); });
    const tree = await render();
    expect(byLabel(tree, 'Reading your body…').length).toBeGreaterThan(0);
    expect(texts(tree.toJSON()).some((s) => s === '—')).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

// ── H1: the state label display map, the AI notice and the not-a-medical-device line ─────────────
describe('PulseScreen — no clinical label, the AI notice and the medical disclaimer (H1)', () => {
  // Face forcing without leaking into later tests (see OnboardingScreen.test.tsx for why not spyOn).
  const colorSchemeMock = RN.useColorScheme as unknown as jest.Mock;
  const PRESET = colorSchemeMock.getMockImplementation();
  const forceFace = (face: ThemeName) => colorSchemeMock.mockImplementation(() => face);
  // Every tree is swept pass-or-fail, so a failing assertion cannot leak an open handle.
  const live: ReactTestRenderer.ReactTestRenderer[] = [];
  const open = async () => { const t = await render(); live.push(t); return t; };
  afterEach(async () => {
    for (const t of live.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
    colorSchemeMock.mockImplementation(PRESET);
  });

  const withStatus = async (status: string | null, confidence: number | null = 0.9) => {
    await ReactTestRenderer.act(async () => {
      pulseStateStore.setState(withData({ stateVector: { status, confidence, computedAt: null } }) as any);
    });
  };
  // A host (native) node of the given RN type — 'View' / 'Text' are strings in the jest renderer.
  const isHost = (n: { type: unknown }, name: 'View' | 'Text') => n.type === name;
  const hostTexts = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => isHost(n, 'Text'));
  const bands = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root.findAll((n) => isHost(n, 'View') && n.props.testID === 'legal-note');
  const header = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root.findAll((n) => isHost(n, 'Text') && n.props.accessibilityRole === 'header');
  const flat = (node: any) => RN.StyleSheet.flatten(node.props.style) as any;
  const ancestors = (node: any) => { const out: any[] = []; for (let p = node.parent; p; p = p.parent) out.push(p); return out; };
  // VISIBLE, not merely present: nothing on the band, its lines or any ancestor fades, collapses,
  // hides or moves it. The device dump (visible-to-user, on-screen bounds) is the closing evidence.
  const expectVisible = (band: any) => {
    for (const n of [band, ...ancestors(band)]) {
      const s = (RN.StyleSheet.flatten(n.props?.style) ?? {}) as any;
      expect(s.opacity ?? 1).toBe(1);
      expect(s.display).not.toBe('none');
      for (const k of ['width', 'height', 'maxWidth', 'maxHeight']) expect(s[k]).not.toBe(0);
      expect(s.transform).toBeUndefined();
    }
    for (const line of band.findAll((n: any) => isHost(n, 'Text'))) {
      expect(flat(line).opacity ?? 1).toBe(1);
      expect(flat(line).color).not.toBe('transparent');
    }
  };
  const expectLegalBand = (tree: ReactTestRenderer.ReactTestRenderer) => {
    expect(bands(tree)).toHaveLength(1);
    const lines = bands(tree)[0].findAll((n) => isHost(n, 'Text')).map((t) => t.props.children);
    expect(lines).toStrictEqual([AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER, MEDICAL_CONSULT_REMINDER]);
    expectVisible(bands(tree)[0]);
  };
  const expectReachable = (tree: ReactTestRenderer.ReactTestRenderer) => {
    for (const a of ancestors(bands(tree)[0])) {
      expect(a.props.pointerEvents).not.toBe('none');
      expect(a.props.accessibilityElementsHidden).not.toBe(true);
      expect(a.props.importantForAccessibility).not.toBe('no-hide-descendants');
      expect(a.props.accessibilityLiveRegion ?? 'none').toBe('none'); // outside Skeleton.Group / EmptyState
    }
  };
  // The StateCard is the nearest HOST View above the pointerEvents="none" emotion wash. Never the
  // wash's `.parent`: the jest-preset View mock is a class that renders the host 'View', so a host's
  // `.parent` is its own mock wrapper, and a pin against that wrapper can never fail. The card is
  // proven by its own style (raised surface, xl corners) and by holding the headline.
  const stateCard = (tree: ReactTestRenderer.ReactTestRenderer, face: ThemeName) => {
    const washes = Object.values(colors[face].emotionAccent).map((q) => q.wash);
    const wash = tree.root.findAll((n) => isHost(n, 'View') && n.props.pointerEvents === 'none' && washes.includes(flat(n).backgroundColor));
    expect(wash).toHaveLength(1);
    const card = ancestors(wash[0]).find((a) => isHost(a, 'View'));
    expect(card).toBeDefined();
    expect(flat(card).borderRadius).toBe(radius.xl);
    expect(flat(card).backgroundColor).toBe(colors[face].surface.raised);
    expect(card.findAll((n: any) => isHost(n, 'Text') && n.props.accessibilityRole === 'header')).toHaveLength(1);
    return { wash: wash[0], card };
  };

  it('NEVER renders the pre-panic key: the headline is the display constant and no node says panic/stress', async () => {
    await withStatus('High-Stress / Pre-Panic');
    const tree = await open();
    expect(header(tree)).toHaveLength(1);
    expect(header(tree)[0].props.children).toBe(STATE_LABEL_HIGH_ACTIVATION);
    expect(header(tree)[0].props.accessibilityLabel).toBeUndefined(); // accessible name = the display label
    expect(allText(tree)).not.toMatch(/panic|stress/i);
    const labels = tree.root.findAll((n) => typeof n.props.accessibilityLabel === 'string').map((n) => n.props.accessibilityLabel);
    expect(labels.join(' | ')).not.toMatch(/panic|stress/i);
  });

  it.each(['light', 'dark'] as ThemeName[])('the RAW backend key still drives the violet "intense" wash (%s)', async (face) => {
    forceFace(face);
    await withStatus('High-Stress / Pre-Panic');
    const tree = await open();
    expect(flat(stateCard(tree, face).wash).backgroundColor).toBe(colors[face].emotionAccent.intense.wash);
  });

  it('an unknown backend label renders the neutral constant, never verbatim (fails closed)', async () => {
    await withStatus('Some Future Rule Label');
    const tree = await open();
    expect(header(tree)[0].props.children).toBe(STATE_LABEL_FALLBACK);
    expect(allText(tree)).not.toContain('Some Future Rule Label');
  });

  // RE-PINNED under DEC-091 (HX-7): the order was [headline, '90% read confidence', …]. The
  // confidence line is gone and nothing replaces it, so the AI notice follows the headline directly.
  it('loaded with a state: AI notice, disclaimer, then the consult reminder, straight after the headline in tree order', async () => {
    await withStatus('Peak Athletic Performance', 0.9);
    const tree = await open();
    expectLegalBand(tree);
    const t = hostTexts(tree);
    const iHead = t.indexOf(header(tree)[0]);
    const tail = t.slice(iHead).map((n) => texts(n.props.children).join(''));
    expect(tail).toStrictEqual(['Peak Athletic Performance', AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER, MEDICAL_CONSULT_REMINDER]);
  });

  // CMP-086: no number, %, "confidence" or "accuracy" on the read, in any state, on screen or spoken.
  // Low confidence is included: it used to add "connect a wearable for a fuller read".
  it.each([
    ['loaded, high confidence', () => withStatus('Peak Athletic Performance', 0.9)],
    ['loaded, low confidence', () => withStatus('Resting / Meditative', 0.2)],
    ['loaded, no state label', () => withStatus(null, null)],
    ['live Health Connect heart rate', async () => {
      await withStatus('Peak Athletic Performance', 0.9);
      await ReactTestRenderer.act(async () => {
        warmStore.getState().setBiometricSource('health-connect');
        warmStore.getState().setLiveHr(62);
      });
    }],
    ['syncing', () => ReactTestRenderer.act(async () => { pulseStateStore.setState({ data: null, loading: true } as any); })],
    ['empty', async () => {}],
  ] as [string, () => Promise<unknown>][])('no %, "confidence", "accuracy" or "fuller read" anywhere: %s', async (_state, arrange) => {
    await arrange();
    const tree = await open();
    const spoken = tree.root.findAll((n) => typeof n.props.accessibilityLabel === 'string').map((n) => n.props.accessibilityLabel);
    const shown = hostTexts(tree).map((n) => texts(n.props.children).join(''));
    expect(shown.length).toBeGreaterThan(0);
    for (const s of [...shown, ...spoken]) expect(s).not.toMatch(/%|confidence|accura|fuller read/i);
  });

  it('sits OUTSIDE the StateCard (never on the inferred-state wash), right after it at a tighter md gap', async () => {
    forceFace('dark');
    await withStatus('High-Stress / Pre-Panic');
    const tree = await open();
    const { card } = stateCard(tree, 'dark');
    const band = bands(tree)[0];
    // Booleans, not toContain: a failing toContain pretty-prints whole fibers and blows the timeout.
    expect(ancestors(band).includes(card)).toBe(false);
    expect(card.findAll((n: any) => n.props.testID === 'legal-note')).toHaveLength(0);
    // Not inside the body stack either: the band is the stack's next sibling, so it follows the card.
    const stack = ancestors(card).find((a) => isHost(a, 'View') && flat(a)?.gap === space.xl);
    expect(stack).toBeDefined();
    expect(ancestors(band).includes(stack)).toBe(false);
    const common = ancestors(stack).find((a) => ancestors(band).includes(a));
    const kids = common.children.filter((ch: any) => typeof ch !== 'string');
    const iStack = kids.findIndex((ch: any) => ch === stack || ancestors(stack).includes(ch));
    const iBand = kids.findIndex((ch: any) => ch === band || ancestors(band).includes(ch));
    expect(iStack).toBeGreaterThanOrEqual(0);
    expect(iBand).toBe(iStack + 1);
    // The caller's wrapper (LegalNote takes no style) carries the gap.
    expect(flat(tree.root.findByType(LegalNote).parent).marginTop).toBe(space.md);
  });

  it('empty state: the wrapper keeps the xl rhythm below EmptyState', async () => {
    const tree = await open();
    expect(flat(tree.root.findByType(LegalNote).parent).marginTop).toBe(space.xl);
  });

  it('loaded with NO state label (placeholder + connect link): the band still renders after the card', async () => {
    await withStatus(null, null);
    const tree = await open();
    expect(allText(tree)).toContain("Your state will appear once your body's being read");
    expectLegalBand(tree);
    const t = hostTexts(tree).map((n) => texts(n.props.children).join(''));
    expect(t.slice(-3)).toStrictEqual([AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER, MEDICAL_CONSULT_REMINDER]);
  });

  it('loading skeleton: the band is present, static, and OUTSIDE the busy live region', async () => {
    await ReactTestRenderer.act(async () => { pulseStateStore.setState({ data: null, loading: true } as any); });
    const tree = await open();
    expect(byLabel(tree, 'Reading your body…').length).toBeGreaterThan(0);
    expectLegalBand(tree);
    expectReachable(tree);
  });

  it('empty state: the band is present after EmptyState, outside its live region and fade', async () => {
    const tree = await open();
    expect(allText(tree)).toContain("Your body isn't in the picture yet");
    expectLegalBand(tree);
    expectReachable(tree);
    for (const a of ancestors(bands(tree)[0])) expect(flat(a)?.opacity).toBeUndefined();
  });

  it('is reachable when loaded: no ancestor hides it, swallows touches, or makes it a live region', async () => {
    await withStatus('Peak Athletic Performance');
    const tree = await open();
    expectReachable(tree);
    for (const line of bands(tree)[0].findAll((n) => isHost(n, 'Text'))) {
      expect(line.props.numberOfLines).toBeUndefined();
      expect(line.props.allowFontScaling).not.toBe(false);
    }
  });

  it.each(['light', 'dark'] as ThemeName[])('is NEVER tinted: identical band with an intense status and a calm status (%s)', async (face) => {
    forceFace(face);
    const styleFor = async (status: string) => {
      await withStatus(status);
      const tree = await open();
      return { band: flat(bands(tree)[0]), lines: bands(tree)[0].findAll((n) => isHost(n, 'Text')).map(flat) };
    };
    const intense = await styleFor('High-Stress / Pre-Panic');
    const calm = await styleFor('Resting / Meditative');
    expect(intense).toEqual(calm);
    expect(intense.band.backgroundColor).toBe(textScrimFill(colors[face], face));
    for (const l of intense.lines) expect(l.color).toBe(colors[face].content.secondary);
  });
});
