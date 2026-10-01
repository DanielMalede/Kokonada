/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { AccessibilityInfo, Linking, StyleSheet } from 'react-native';

jest.setTimeout(20000); // cold-require headroom for CI (compile time, not assertion time)

jest.mock('../../../design/haptics', () => ({ fireHaptic: jest.fn() }));
// The build that renders the link: the same module, with the hosted flag on. Nothing else differs.
jest.mock('../../../legal/legalLinks', () => ({ ...jest.requireActual('../../../legal/legalLinks'), PRIVACY_POLICY_HOSTED: true }));

import { ConsentSheet } from '../ConsentSheet';
import { createConsentFlow } from '../../../health/consentStore';
import type { ConsentStatus } from '../../../health/consentApi';
import { space, type ThemeName } from '../../../design/tokens';
import { PRIVACY_POLICY_HOSTED, PRIVACY_POLICY_URL } from '../../../legal/legalLinks';

// HX-5 under DEC-117: what the consent sheet does once the policy page is hosted. The link sits in
// the chrome directly below the scroll cue — outside the consent document and outside
// CONSENT_SECTIONS — only in the four wall states, inert while a grant is being recorded. Opening
// the policy is navigation, never consent: a press records nothing, opens no Health Connect sheet
// and leaves the flow where it was (Play User Data policy: navigation away is not consent). Apart
// from the link and the designer's scroll-cue padding, the sheet is node for node main's.

const FIXTURE = path.join(__dirname, '__fixtures__', 'consentSheetMain.json');
const MAIN: Record<string, Record<string, any>> = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).faces;
const FACES: ThemeName[] = ['light', 'dark'];
const WALL_STATES = ['consent_required', 'consent_stale', 'submitting_grant', 'submit_error'] as const;
type WallState = (typeof WALL_STATES)[number];

const status = (over: Partial<ConsentStatus> = {}): ConsentStatus => ({ granted: false, currentVersion: 1, staleVersion: false, ...over });
const openURL = Linking.openURL as jest.Mock;

const colorSchemeMock = RN.useColorScheme as unknown as jest.Mock;
const PRESET_COLOR_SCHEME = colorSchemeMock.getMockImplementation();
const forceFace = (scheme: ThemeName) => colorSchemeMock.mockImplementation(() => scheme);
const releaseFace = () => colorSchemeMock.mockImplementation(PRESET_COLOR_SCHEME);

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const t of mounted.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
  releaseFace();
});
beforeEach(() => {
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(true);
  openURL.mockReset();
  openURL.mockResolvedValue(true);
});

type Tree = ReactTestRenderer.ReactTestRenderer;
const flush = () => ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
const byTestId = (tree: Tree, id: string) => tree.root.findAll((n) => n.props.testID === id && n.parent?.props?.testID !== id);
const link = (tree: Tree) => byTestId(tree, 'privacy-policy-link');
const hostIndex = (tree: Tree, id: string) => tree.root.findAll((n) => typeof n.type === 'string').findIndex((n) => n.props.testID === id);

async function mount(store: ReturnType<typeof createConsentFlow>, onProceed = jest.fn(), onDecline = jest.fn()) {
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ConsentSheet store={store} onProceed={onProceed} onDecline={onDecline} />);
  });
  mounted.push(tree);
  await flush();
  return tree;
}

// The sheet, driven to `state` through the REAL consent store (only the two network calls are fakes).
async function renderWall(state: WallState) {
  const grant = state === 'submit_error'
    ? jest.fn().mockResolvedValue({ ok: false, error: 'network error' })
    : jest.fn().mockReturnValue(new Promise(() => {}));
  const onProceed = jest.fn();
  const onDecline = jest.fn();
  const store = createConsentFlow({ fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: status() }), grant });
  store.getState().hydrate(state === 'consent_stale' ? status({ granted: true, staleVersion: true }) : status());
  const tree = await mount(store, onProceed, onDecline);
  if (state === 'submitting_grant' || state === 'submit_error') {
    await ReactTestRenderer.act(async () => { byTestId(tree, 'consent-agree')[0].props.onPress(); });
    await flush();
  }
  expect(store.getState().flow).toBe(state);
  return { tree, store, grant, onProceed, onDecline };
}

const canonical = (tree: Tree) => JSON.parse(JSON.stringify(tree.toJSON()));
const contains = (node: any, id: string): boolean =>
  !!node && typeof node === 'object' && (node.props?.testID === id || (node.children ?? []).some((c: any) => contains(c, id)));
const find = (node: any, id: string): any =>
  node?.props?.testID === id ? node : (node?.children ?? []).map((c: any) => find(c, id)).find(Boolean);
const textOf = (node: any): string =>
  typeof node === 'string' ? node : (node?.children ?? []).map(textOf).join('␞');

it('this suite renders the hosted build (the module mock took)', () => {
  expect(PRIVACY_POLICY_HOSTED).toBe(true);
});

describe('where the link renders', () => {
  it.each(WALL_STATES)('%s: one link', async (state) => {
    const { tree } = await renderWall(state);
    expect(link(tree)).toHaveLength(1);
  });

  it('checking (the skeleton): no link', async () => {
    const store = createConsentFlow({ fetchStatus: jest.fn().mockReturnValue(new Promise(() => {})), grant: jest.fn() });
    const tree = await mount(store);
    expect(byTestId(tree, 'consent-skeleton').length).toBeGreaterThan(0);
    expect(link(tree)).toHaveLength(0);
  });

  it('granted_ack ("Consent recorded"): no link', async () => {
    const store = createConsentFlow({
      fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: status() }),
      grant: jest.fn().mockResolvedValue({ ok: true, data: status({ granted: true }) }),
    });
    store.getState().hydrate(status());
    const tree = await mount(store);
    await ReactTestRenderer.act(async () => { await byTestId(tree, 'consent-agree')[0].props.onPress(); });
    await flush();
    expect(store.getState().flow).toBe('granted_ack');
    expect(link(tree)).toHaveLength(0);
  });

  it('in the chrome: outside the consent document, after the scroll cue, before the error and the action bar', async () => {
    const { tree } = await renderWall('submit_error');
    const doc = byTestId(tree, 'consent-document')[0];
    expect(doc.findAll((n) => n.props.testID === 'privacy-policy-link')).toHaveLength(0);
    const at = hostIndex(tree, 'privacy-policy-link');
    expect(hostIndex(tree, 'consent-scroll-cue')).toBeLessThan(at);
    expect(at).toBeLessThan(hostIndex(tree, 'consent-error'));
    expect(at).toBeLessThan(hostIndex(tree, 'consent-decline'));
    expect(at).toBeLessThan(hostIndex(tree, 'consent-agree'));
  });

  it('centred', async () => {
    const { tree } = await renderWall('consent_required');
    const wrapper = canonical(tree).children.find((c: any) => contains(c, 'privacy-policy-link'));
    expect(wrapper.props.style).toEqual({ alignItems: 'center' });
  });
});

describe('inert while a grant is being recorded', () => {
  it('submitting_grant: disabled, and a press opens nothing', async () => {
    const { tree } = await renderWall('submitting_grant');
    expect(link(tree)[0].props.accessibilityState).toEqual({ disabled: true });
    await ReactTestRenderer.act(async () => { link(tree)[0].props.onPress(); });
    await flush();
    expect(openURL).not.toHaveBeenCalled();
  });

  it.each(['consent_required', 'consent_stale', 'submit_error'] as const)('%s: enabled', async (state) => {
    const { tree } = await renderWall(state);
    expect(link(tree)[0].props.accessibilityState).toEqual({ disabled: false });
  });
});

describe('opening the policy is navigation, never consent', () => {
  it.each(['consent_required', 'consent_stale', 'submit_error'] as const)(
    '%s: a press opens the policy and records nothing, opens no Health Connect sheet, leaves the flow as it was',
    async (state) => {
      const { tree, store, grant, onProceed, onDecline } = await renderWall(state);
      const grantsBefore = grant.mock.calls.length;
      await ReactTestRenderer.act(async () => { link(tree)[0].props.onPress(); });
      await flush();
      expect(openURL).toHaveBeenCalledTimes(1);
      expect(openURL).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
      expect(grant.mock.calls.length).toBe(grantsBefore);
      expect(onProceed).not.toHaveBeenCalled();
      expect(onDecline).not.toHaveBeenCalled();
      expect(store.getState().flow).toBe(state);
    },
  );
});

describe('apart from the link and the cue padding, the sheet is main’s', () => {
  it('the scroll cue tightens to paddingTop space.sm, paddingBottom space.none (it groups with the link)', async () => {
    const { tree } = await renderWall('consent_required');
    const cue = StyleSheet.flatten(byTestId(tree, 'consent-scroll-cue')[0].props.style);
    expect(cue.paddingTop).toBe(space.sm);
    expect(cue.paddingBottom).toBe(space.none);
    expect(cue.paddingVertical).toBeUndefined();
  });

  describe.each(FACES)('%s face', (face) => {
    beforeEach(() => { forceFace(face); });

    it.each(WALL_STATES)('%s: the consent document’s words are byte-identical to main’s', async (state) => {
      const { tree } = await renderWall(state);
      const doc = find(canonical(tree), 'consent-document');
      expect(textOf(doc)).toBe(textOf(find(MAIN[face][state], 'consent-document')));
    });

    it.each(WALL_STATES)('%s: removing the link and restoring main’s cue gives main’s render, node for node', async (state) => {
      const { tree } = await renderWall(state);
      const hosted = canonical(tree);
      const main = MAIN[face][state];
      hosted.children = hosted.children.filter((c: any) => !contains(c, 'privacy-policy-link'));
      find(hosted, 'consent-scroll-cue').props.style = find(main, 'consent-scroll-cue').props.style;
      expect(hosted).toEqual(main);
    });
  });
});
