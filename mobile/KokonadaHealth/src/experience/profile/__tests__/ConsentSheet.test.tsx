import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';

jest.mock('../../../design/haptics', () => ({ fireHaptic: jest.fn() }));

import { ConsentSheet } from '../ConsentSheet';
import { createConsentFlow, type ConsentFlowStore } from '../../../health/consentStore';
import { CONSENT_DATA_CATEGORIES, type ConsentStatus } from '../../../health/consentApi';
import { colors } from '../../../design/tokens';
import { contrastRatio, AA_LARGE } from '../../../design/contrast';

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

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await flush();
  return tree;
}

// Count ONE logical element per JSX node: a Pressable/ScrollView surfaces its testID on BOTH the
// composite instance and the host child it renders, so a naive findAll double/triple-counts. The
// parent-guard keeps only the outermost carrier (the composite, or the sole host for a plain View),
// which is also the instance that owns onPress/style.
const byTestId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id && n.parent?.props?.testID !== id);

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
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });

    it('consent_required → first-time presentation with the full document and both actions', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      expect(byTestId(tree, 'consent-document').length).toBe(1);
      expect(byTestId(tree, 'consent-agree').length).toBe(1);
      expect(byTestId(tree, 'consent-decline').length).toBe(1);
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });

    it('consent_stale → re-confirm framing ("updated") but still requires a fresh Agree', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: true, staleVersion: true }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      expect(texts(tree.toJSON()).join(' ').toLowerCase()).toContain('updated');
      expect(byTestId(tree, 'consent-agree').length).toBe(1);
      await ReactTestRenderer.act(async () => { tree.unmount(); });
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
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });

    it('submit_error → soft inline error + Retry, and Decline STILL works', async () => {
      const store = build({ grant: jest.fn().mockResolvedValue({ ok: false, error: 'network error' }) });
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      await ReactTestRenderer.act(async () => { await byTestId(tree, 'consent-agree')[0].props.onPress(); });
      await flush();
      expect(byTestId(tree, 'consent-error').length).toBe(1);
      expect(byTestId(tree, 'consent-decline')[0].props.accessibilityState?.disabled).toBeFalsy();
      await ReactTestRenderer.act(async () => { tree.unmount(); });
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
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });

    it('NEVER calls onProceed on a failed grant (OS sheet stays shut in the error path)', async () => {
      const onProceed = jest.fn();
      const store = build({ grant: jest.fn().mockResolvedValue({ ok: false, error: 'network error' }) });
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={onProceed} onDecline={jest.fn()} />);
      await ReactTestRenderer.act(async () => { await byTestId(tree, 'consent-agree')[0].props.onPress(); });
      await flush();
      expect(onProceed).not.toHaveBeenCalled();
      await ReactTestRenderer.act(async () => { tree.unmount(); });
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
      await ReactTestRenderer.act(async () => { tree.unmount(); });
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
      await ReactTestRenderer.act(async () => { tree.unmount(); });
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
      await ReactTestRenderer.act(async () => { tree.unmount(); });
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
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });

    it('each content section is a header landmark and the title is the first header (SR focus order)', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      const headers = tree.root.findAll((n) => n.props.accessibilityRole === 'header');
      expect(headers.length).toBeGreaterThanOrEqual(6); // title + the 6 document sections
      expect(byTestId(tree, 'consent-title')[0].props.accessibilityRole).toBe('header');
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });

    it('renders the consent document as REAL selectable text (never an image)', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      const selectable = tree.root.findAll((n) => n.props.selectable === true);
      expect(selectable.length).toBeGreaterThan(0);
      expect(tree.root.findAll((n) => n.type === 'Image').length).toBe(0);
      await ReactTestRenderer.act(async () => { tree.unmount(); });
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
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });

    it('names the sub-processors generically (Groq + the wearable/health provider)', async () => {
      const store = build();
      store.getState().hydrate(status({ granted: false }));
      const tree = await render(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
      const all = texts(tree.toJSON()).join(' ');
      expect(all).toContain('Groq');
      expect(all.toLowerCase()).toMatch(/wearable|health provider/);
      await ReactTestRenderer.act(async () => { tree.unmount(); });
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
      await ReactTestRenderer.act(async () => { tree.unmount(); });
    });
  });
});
