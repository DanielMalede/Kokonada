/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { AccessibilityInfo } from 'react-native';

jest.setTimeout(20000); // cold-require headroom for CI (compile time, not assertion time)

jest.mock('../../../design/haptics', () => ({ fireHaptic: jest.fn() }));

import { ConsentSheet } from '../ConsentSheet';
import { createConsentFlow } from '../../../health/consentStore';
import type { ConsentStatus } from '../../../health/consentApi';
import type { ThemeName } from '../../../design/tokens';
import { PRIVACY_POLICY_HOSTED } from '../../../legal/legalLinks';

// HX-5 under DEC-117 (the regulatory brief's O2 conditions). The consent sheet's privacy-policy link
// renders only once the policy page is hosted, and the designer's scroll-cue padding change ships
// only with it. Until then the rendered consent screen must be EXACTLY main's — every node, prop,
// style and word, in both faces and all four wall states — because a grant is evidence of what the
// grantor was shown (GDPR Art. 7(1); EDPB 05/2020 para 108; REG-034).
//
// The reference is __fixtures__/consentSheetMain.json, recorded from ConsentSheet.tsx as it is on
// main (fd68094) before HX-5 touched it. Re-record it ONLY together with a recorded decision that
// changes the consent screen (a consent-version bump, UI-012; or the flag flip, DEC-117):
//   KOKONADA_RECORD_CONSENT_SHEET=1 ./node_modules/.bin/jest src/experience/profile/__tests__/ConsentSheet.privacyLink.test.tsx

const FIXTURE = path.join(__dirname, '__fixtures__', 'consentSheetMain.json');
const RECORD = process.env.KOKONADA_RECORD_CONSENT_SHEET === '1';
const FACES: ThemeName[] = ['light', 'dark'];
const WALL_STATES = ['consent_required', 'consent_stale', 'submitting_grant', 'submit_error'] as const;
type WallState = (typeof WALL_STATES)[number];

const status = (over: Partial<ConsentStatus> = {}): ConsentStatus => ({ granted: false, currentVersion: 1, staleVersion: false, ...over });

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
  // Reduced motion makes the entry instant, so the recorded tree never depends on animation timing.
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(true);
});

const flush = () => ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
const byTestId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id && n.parent?.props?.testID !== id);

// The sheet, driven to `state` through the REAL consent store (only the two network calls are fakes).
async function renderWall(state: WallState) {
  const grant = state === 'submit_error'
    ? jest.fn().mockResolvedValue({ ok: false, error: 'network error' })
    : jest.fn().mockReturnValue(new Promise(() => {})); // submitting_grant: the POST never settles
  const store = createConsentFlow({ fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: status() }), grant });
  store.getState().hydrate(state === 'consent_stale' ? status({ granted: true, staleVersion: true }) : status());
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ConsentSheet store={store} onProceed={jest.fn()} onDecline={jest.fn()} />);
  });
  mounted.push(tree);
  await flush();
  if (state === 'submitting_grant' || state === 'submit_error') {
    await ReactTestRenderer.act(async () => { byTestId(tree, 'consent-agree')[0].props.onPress(); });
    await flush();
  }
  expect(store.getState().flow).toBe(state);
  return tree;
}

// The rendered tree as data: host elements, their props and their text. Functions are not data.
const canonical = (tree: ReactTestRenderer.ReactTestRenderer) => JSON.parse(JSON.stringify(tree.toJSON()));

describe('this build’s consent sheet is main’s consent sheet, node for node', () => {
  const recorded: Record<string, Record<string, unknown>> = RECORD ? {} : JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).faces;

  it('the page is not hosted yet, so this build renders the sheet without its link (DEC-117)', () => {
    expect(PRIVACY_POLICY_HOSTED).toBe(false);
  });

  describe.each(FACES)('%s face', (face) => {
    beforeEach(() => { forceFace(face); });

    it.each(WALL_STATES)('%s renders exactly as on main', async (state) => {
      const tree = await renderWall(state);
      if (RECORD) { (recorded[face] ??= {})[state] = canonical(tree); return; }
      expect(byTestId(tree, 'privacy-policy-link')).toHaveLength(0);
      expect(canonical(tree)).toEqual(recorded[face][state]);
    });
  });

  afterAll(() => {
    if (!RECORD) return;
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify({
      note: 'ConsentSheet as rendered on main before HX-5 (fd68094), per face and wall state, reduced motion. ' +
        'Re-record only with a recorded decision that changes the consent screen (UI-012 bump, DEC-117 flip).',
      faces: recorded,
    }, null, 1) + '\n');
  });
});
