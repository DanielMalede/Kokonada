import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { AccessibilityInfo } from 'react-native';

// Cold-require headroom for CI (same rationale as NowPlayingScreen/ConnectServicesScreen): on a
// cold babel cache the FIRST test in this file spends ~8s compiling the ConsentSheet module
// graph and blows the 5s default, and jest's abort then cascades into a later test. The
// budget is compile time, not assertion time.
jest.setTimeout(20000);

jest.mock('../../../design/haptics', () => ({ fireHaptic: jest.fn() }));

import { ConsentSheet } from '../ConsentSheet';
import { createConsentFlow, type ConsentFlowStore } from '../../../health/consentStore';
import { CONSENT_DATA_CATEGORIES, type ConsentStatus } from '../../../health/consentApi';
import { colors, type ThemeName } from '../../../design/tokens';
import { contrastRatio, AA_NORMAL, AA_LARGE } from '../../../design/contrast';

const status = (over: Partial<ConsentStatus> = {}): ConsentStatus => ({
  granted: false,
  currentVersion: 1,
  staleVersion: false,
  ...over,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function flush() {
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
}

// Teardown discipline, per FILE rather than per call site. A failed assertion aborts the test body,
// so a trailing tree.unmount() never runs — and a leaked tree keeps its Animated entry running into
// the NEXT test's window, failing that one too and hiding the real cause behind a cascade. Every
// render registers here and is swept unconditionally, pass or fail.
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const t of mounted.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
});

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await flush();
  mounted.push(tree);
  return tree;
}

// Count ONE logical element per JSX node: a Pressable/ScrollView surfaces its testID on BOTH the
// composite instance and the host child it renders, so a naive findAll double/triple-counts. The
// parent-guard keeps only the outermost carrier (the composite, or the sole host for a plain View),
// which is also the instance that owns onPress/style.
const byTestId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id && n.parent?.props?.testID !== id);


// The standard primary CTA wears the INK fill (accent.ctaFill + content.onCtaFill), NOT the aurora
// violet. POSITIVE colour claims are pinned per FACE (see the describe.each below); only the
// NEGATIVE sets stay theme-spanning, because excluding a hue in BOTH faces is strictly stronger
// than excluding it in one. glowInk/onAccent stay live tokens (they feed the Generate hero's
// gradient), so their ABSENCE from a standard CTA has to be asserted, never inferred.
const GLOW_INKS = [colors.light.accent.glowInk, colors.dark.accent.glowInk];
const ON_ACCENTS = [colors.light.content.onAccent, colors.dark.content.onAccent];
const EMOTION_INKS = (['calm', 'joyful', 'intense', 'reflective'] as const)
  .flatMap((q) => [colors.light.emotionAccent[q].ink, colors.dark.emotionAccent[q].ink]);
const FACES: ThemeName[] = ['light', 'dark'];
// Forcing the face, correctly. jest.spyOn CANNOT do it here: @react-native/jest-preset already
// installs react-native's useColorScheme as a jest.fn(() => 'light'), and jest-mock's spyOn returns
// an EXISTING mock untouched WITHOUT registering a restore (jest-mock/build/index.js — the whole
// spy branch is guarded by `if (!this.isMockFunction(original))`). So mockReturnValue mutates the
// preset's shared mock permanently and jest.restoreAllMocks() is a no-op against it, leaking the
// last face into every later test in the file. Capture the preset's own implementation and put it
// back by hand.
const colorSchemeMock = RN.useColorScheme as unknown as jest.Mock;
const PRESET_COLOR_SCHEME = colorSchemeMock.getMockImplementation();
const forceFace = (scheme: ThemeName) => colorSchemeMock.mockImplementation(() => scheme);
const releaseFace = () => colorSchemeMock.mockImplementation(PRESET_COLOR_SCHEME);
// WCAG 2.2 SC 1.4.6 (Contrast Enhanced). Not a token-system-wide threshold — it is the bar THIS
// screen is held to, because it is the Art.9 consent wall.
const AAA_NORMAL = 7;
// Agree may lead Decline in measured contrast (a reversed label on an extreme ink fill necessarily
// beats ink-on-paper), but never by a margin that could read as disadvantaging the refusal. Today:
// 1.037 dark, 1.093 light. 1.15 keeps headroom over the worst face and still fires long before
// Decline could approach the EDPB's "unreadable to virtually any user" band.
const AGREE_LEAD_MAX = 1.15;
const flattenStyle = (node: any): Record<string, any> => {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
};
const firstText = (node: any) => node.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text')[0];

const texts = (node: any, acc: string[] = []): string[] => {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
};

beforeEach(() => {
  jest.clearAllMocks();
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
});

describe('ConsentSheet (GDPR Art.9 consent wall)', () => {
  const build = (over: { fetchStatus?: jest.Mock; grant?: jest.Mock } = {}): ConsentFlowStore =>
    createConsentFlow({
      fetchStatus: over.fetchStatus ?? jest.fn().mockResolvedValue({ ok: true, data: status() }),
      grant: over.grant ?? jest.fn().mockResolvedValue({ ok: true, data: status({ granted: true }) }),
    });

  describe('state table — renders the correct surface for each flow state', () => {
    it('checking → a calm skeleton, never a spinner or the wall', async () => {
      const store = build({ fetchStatus: jest.fn().mockReturnValue(new Promise(() => {})) }); // never resolves
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      expect(byTestId(tree, 'consent-skeleton').length).toBeGreaterThan(0);
      expect(byTestId(tree, 'consent-agree').length).toBe(0);
      // NOT a spinner: no ActivityIndicator anywhere.
      expect(tree.root.findAll((n) => n.type === 'ActivityIndicator').length).toBe(0);
    });

    it('consent_required → first-time presentation with the full document and both actions', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      expect(byTestId(tree, 'consent-document').length).toBe(1);
      expect(byTestId(tree, 'consent-agree').length).toBe(1);
      expect(byTestId(tree, 'consent-decline').length).toBe(1);
    });

    it('consent_stale → re-confirm framing ("updated") but still requires a fresh Agree', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: true, staleVersion: true }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      expect(texts(tree.toJSON()).join(' ').toLowerCase()).toContain('updated');
      expect(byTestId(tree, 'consent-agree').length).toBe(1);
    });

    it('submitting_grant → both buttons locked while the POST is in flight', async () => {
      const grant = deferred<any>();
      const store = build({ grant: jest.fn().mockReturnValue(grant.promise) });
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      await ReactTestRenderer.act(async () => { byTestId(tree, 'consent-agree')[0].props.onPress(); });
      expect(byTestId(tree, 'consent-agree')[0].props.accessibilityState?.disabled).toBe(true);
      expect(byTestId(tree, 'consent-decline')[0].props.accessibilityState?.disabled).toBe(true);
      grant.resolve({ ok: true, data: status({ granted: true }) });
      await flush();
    });

    it('submit_error → soft inline error + Retry, and Decline STILL works', async () => {
      const store = build({ grant: jest.fn().mockResolvedValue({ ok: false, error: 'network error' }) });
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      await ReactTestRenderer.act(async () => { await byTestId(tree, 'consent-agree')[0].props.onPress(); });
      await flush();
      expect(byTestId(tree, 'consent-error').length).toBe(1);
      expect(byTestId(tree, 'consent-decline')[0].props.accessibilityState?.disabled).toBeFalsy();
    });
  });

  describe('the compliance gate — the OS health sheet opens ONLY after a server-acked current grant', () => {
    it('short-circuit: an existing current grant (ready) proceeds straight through, wall never rendered', async () => {
      const onProceed = jest.fn();
      const store = build();
      store.getState().hydrate(status({ granted: true, staleVersion: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={onProceed} onDecline={jest.fn()} />);
      expect(onProceed).toHaveBeenCalledTimes(1);
      expect(byTestId(tree, 'consent-document').length).toBe(0); // the wall is never shown
    });

    it('NEVER calls onProceed on a failed grant (OS sheet stays shut in the error path)', async () => {
      const onProceed = jest.fn();
      const store = build({ grant: jest.fn().mockResolvedValue({ ok: false, error: 'network error' }) });
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={onProceed} onDecline={jest.fn()} />);
      await ReactTestRenderer.act(async () => { await byTestId(tree, 'consent-agree')[0].props.onPress(); });
      await flush();
      expect(onProceed).not.toHaveBeenCalled();
    });

    it('calls onProceed ONLY after the 201 echo (granted_ack) — not while the grant is still submitting', async () => {
      const onProceed = jest.fn();
      const grant = deferred<any>();
      const store = build({ grant: jest.fn().mockReturnValue(grant.promise) });
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={onProceed} onDecline={jest.fn()} />);
      await ReactTestRenderer.act(async () => { byTestId(tree, 'consent-agree')[0].props.onPress(); });
      // still submitting → the OS sheet must NOT have been opened yet
      expect(onProceed).not.toHaveBeenCalled();
      await ReactTestRenderer.act(async () => { grant.resolve({ ok: true, data: status({ granted: true }) }); });
      await flush();
      expect(onProceed).toHaveBeenCalledTimes(1);
    });

    it('Decline moves to onDecline without any grant POST (mood-only path stays intact)', async () => {
      const onDecline = jest.fn();
      const grant = jest.fn();
      const store = build({ grant });
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={onDecline} />);
      await ReactTestRenderer.act(async () => { byTestId(tree, 'consent-decline')[0].props.onPress(); });
      await flush();
      expect(onDecline).toHaveBeenCalledTimes(1);
      expect(grant).not.toHaveBeenCalled();
    });
  });

  describe('accessibility + equal-weight (the compliance-critical UI invariants)', () => {
    it('Decline is provably equal in size/geometry to Agree (no confirmshaming, equal tap target)', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      const flat = (id: string) => {
        const s = byTestId(tree, id)[0].props.style;
        return Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s;
      };
      const agree = flat('consent-agree');
      const decline = flat('consent-decline');
      expect(decline.flex).toBe(agree.flex);
      expect(decline.paddingVertical).toBe(agree.paddingVertical);
      expect(decline.borderRadius).toBe(agree.borderRadius);
    });

    // ── FACE-FORCED action-bar pins ─────────────────────────────────────────────────────
    // @react-native/jest-preset REPLACES react-native's useColorScheme with jest.fn(() => 'light'),
    // so an unforced render always resolves the LIGHT face — the shipping DARK face was never
    // rendered here at all. Asserting set-membership across a union of both faces therefore waved
    // a CROSS-FACE pairing through: hard-coding colors.dark.accent.ctaFill under a light-face
    // label renders #FAFAFF on #EEF1FC — 1.08:1, an invisible button on the Art.9 wall — with
    // every assertion still green. Forcing the scheme runs the REAL useTheme → resolveScheme path
    // in BOTH faces, pins each value EXACTLY, and measures the rendered pair, so the class dies
    // whichever call site is edited next.
    describe.each(FACES)('the action bar, rendered on the %s face', (scheme) => {
      const C = colors[scheme];
      beforeEach(() => { forceFace(scheme); });
      afterEach(() => { releaseFace(); });

      const renderWall = async () => {
        const store = build();
        store.getState().hydrate(status({ granted: false }));
        return render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      };

      it('Agree wears THIS face\u2019s ink fill AND THIS face\u2019s label — never the aurora violet, never a re-tint', async () => {
        const tree = await renderWall();
        const agree = byTestId(tree, 'consent-agree')[0];
        const s = flattenStyle(agree);
        const label = flattenStyle(firstText(agree));
        expect(s.backgroundColor).toBe(C.accent.ctaFill);
        expect(s.borderColor).toBe(C.accent.ctaFill);
        expect(label.color).toBe(C.content.onCtaFill);
        // The assertion that kills the cross-face class outright, independently of the exact
        // values: whatever the two colours are, the label must be readable ON the fill it is
        // actually painted over.
        expect(contrastRatio(label.color, s.backgroundColor)).toBeGreaterThanOrEqual(AA_NORMAL);
        expect(GLOW_INKS).not.toContain(s.backgroundColor);
        expect(ON_ACCENTS).not.toContain(label.color);
        // …and it is still NOT the reactive emotion accent — a legal choice is never nudged.
        expect(EMOTION_INKS).not.toContain(s.backgroundColor);
      });

      // The LEGAL property (SCREENS §11). NOT "Decline carries the highest contrast on the
      // screen" — that claim inverted silently the moment the CTA took the ink fill, because a
      // reversed label on an extreme fill necessarily beats ink-on-paper. What the EDPB Cookie
      // Banner Taskforce Report (17 Jan 2023, paras 17-18) actually names as the breach is a
      // Decline the user cannot read. So what is pinned is: both labels clear AAA, and Agree
      // never materially leads Decline.
      it('Decline is never disadvantaged relative to Agree — both clear AAA, Agree leads by at most 15%', async () => {
        const tree = await renderWall();
        const decline = byTestId(tree, 'consent-decline')[0];
        const agree = byTestId(tree, 'consent-agree')[0];
        const sheetBg = flattenStyle(byTestId(tree, 'consent-sheet')[0]).backgroundColor;
        // Decline is an OUTLINE control, so its label is read against the sheet's own surface.
        expect(flattenStyle(decline).backgroundColor).toBeUndefined();
        expect(sheetBg).toBe(C.surface.base);

        const declineRatio = contrastRatio(flattenStyle(firstText(decline)).color, sheetBg);
        const agreeRatio = contrastRatio(flattenStyle(firstText(agree)).color, flattenStyle(agree).backgroundColor);
        expect(declineRatio).toBeGreaterThanOrEqual(AAA_NORMAL);
        expect(agreeRatio).toBeGreaterThanOrEqual(AAA_NORMAL);
        expect(agreeRatio / declineRatio).toBeLessThanOrEqual(AGREE_LEAD_MAX);
      });
    });

    it('both actions announce their role AND consequence (never bare OK/Cancel)', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      const agree = byTestId(tree, 'consent-agree')[0];
      const decline = byTestId(tree, 'consent-decline')[0];
      expect(agree.props.accessibilityRole).toBe('button');
      expect(decline.props.accessibilityRole).toBe('button');
      expect(agree.props.accessibilityLabel).toMatch(/health permission/i);
      expect(decline.props.accessibilityLabel).toMatch(/decline/i);
    });

    it('each content section is a header landmark and the title is the first header (SR focus order)', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      const headers = tree.root.findAll((n) => n.props.accessibilityRole === 'header');
      expect(headers.length).toBeGreaterThanOrEqual(6); // title + the 6 document sections
      expect(byTestId(tree, 'consent-title')[0].props.accessibilityRole).toBe('header');
    });

    it('renders the consent document as REAL selectable text (never an image)', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      const selectable = tree.root.findAll((n) => n.props.selectable === true);
      expect(selectable.length).toBeGreaterThan(0);
      expect(tree.root.findAll((n) => n.type === 'Image').length).toBe(0);
    });

    it('lists every locked data category across wearable lanes (HC scope-min + Garmin-sourced shape)', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      const all = texts(tree.toJSON()).join(' ').toLowerCase();
      // The copy must enumerate exactly the categories sent to the backend — the UNION across
      // wearable lanes. Health Connect stays scope-minimized (PR #152 T3); the Garmin server-to-
      // server lane's SpO2/respiration/Body Battery are disclosed too (labelled as Garmin-sourced)
      // so the umbrella consent covers them before that backend-gated lane goes live.
      expect(CONSENT_DATA_CATEGORIES.length).toBe(8);
      // Health Connect lane:
      expect(all).toContain('heart rate');
      expect(all).toContain('hrv');
      expect(all).toContain('sleep');
      expect(all).toContain('resting heart rate');
      expect(all).toMatch(/6 month|historical/);
      // Garmin server-to-server lane (provider-specific, disclosed ahead of go-live):
      expect(all).toMatch(/spo|blood oxygen/);
      expect(all).toContain('respiration');
      expect(all).toContain('body battery');
      expect(all).toContain('garmin'); // each Garmin-only category names its source — never over-claiming for a Health-Connect-only user
      // background_access is still NOT disclosed — no lane reads it.
      expect(all).not.toContain('background');
    });

    it('names the sub-processors generically (Groq + the wearable/health provider)', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      const all = texts(tree.toJSON()).join(' ');
      expect(all).toContain('Groq');
      expect(all.toLowerCase()).toMatch(/wearable|health provider/);
    });
  });

  describe('Decline border meets WCAG 2.2 1.4.11 (3:1 non-text contrast), unlike the hairline token', () => {
    it('content.tertiary (the chosen Decline border) passes 3:1 on the base surface in BOTH themes', () => {
      for (const t of [colors.dark, colors.light]) {
        expect(contrastRatio(t.content.tertiary, t.surface.base)).toBeGreaterThanOrEqual(AA_LARGE);
      }
    });

    it('proves WHY hairline was rejected — it FAILS 3:1 in both themes', () => {
      for (const t of [colors.dark, colors.light]) {
        expect(contrastRatio(t.surface.hairline, t.surface.base)).toBeLessThan(AA_LARGE);
      }
    });
  });

  describe('reduced motion — instant entry, byte-identical layout', () => {
    it('renders the same landmarks under reduced motion (no dependence on the entry animation)', async () => {
      (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      expect(byTestId(tree, 'consent-document').length).toBe(1);
      expect(byTestId(tree, 'consent-agree').length).toBe(1);
      expect(byTestId(tree, 'consent-decline').length).toBe(1);
    });
  });
});
