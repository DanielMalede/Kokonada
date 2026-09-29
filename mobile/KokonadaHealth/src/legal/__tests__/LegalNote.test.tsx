import React from 'react';
import * as RN from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo, Keyboard } from 'react-native';
import { LegalNote } from '../LegalNote';
import { AI_DISCLOSURE_LONG, AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER, MEDICAL_CONSULT_REMINDER, PULSE_LEGAL_LINES } from '../legalCopy';
import { colors, space, radius, type as typography, type ThemeName } from '../../design/tokens';
import { textScrimFill } from '../../design/auroraSurfaces';

// LegalNote — the ONE primitive every legal line renders through (designer direction §1): a quiet
// band on the AA-proven text scrim, content.secondary at body size, one Text node per line, no
// tint, no motion, no dismiss, nothing hidden from the accessibility tree.

// Face forcing without leaking: the jest preset installs useColorScheme as a shared jest.fn, and
// spyOn would mutate it permanently (see OnboardingScreen.test.tsx). Capture and restore by hand.
const colorSchemeMock = RN.useColorScheme as unknown as jest.Mock;
const PRESET = colorSchemeMock.getMockImplementation();
const forceFace = (scheme: ThemeName) => colorSchemeMock.mockImplementation(() => scheme);
afterEach(() => { colorSchemeMock.mockImplementation(PRESET); jest.restoreAllMocks(); });

const FACES: ThemeName[] = ['light', 'dark'];
const flat = (node: any) => RN.StyleSheet.flatten(node.props.style) as any;
// A host (native) node of the given RN type — 'View' / 'Text' are strings in the jest renderer.
const isHost = (n: { type: unknown }, name: 'View' | 'Text') => n.type === name;
const hostTexts = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => isHost(n, 'Text'));
const hostNodes = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => typeof n.type === 'string');
const band = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => isHost(n, 'View') && n.props.testID === 'legal-note')[0];

function render(lines: React.ComponentProps<typeof LegalNote>['lines']) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(<LegalNote lines={lines} />); });
  return tree;
}

describe('LegalNote — one readable Text node per line, in order', () => {
  it('renders each line as its own Text whose only child is the constant', () => {
    const tree = render([AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER]);
    const texts = hostTexts(tree);
    expect(texts).toHaveLength(2);
    expect(texts[0].props.children).toBe(AI_DISCLOSURE_SHORT); // a single string, never fragments
    expect(texts[1].props.children).toBe(MEDICAL_DISCLAIMER);
  });

  it('renders the full Pulse band — notice, disclaimer, consult reminder — as three Text nodes in that order', () => {
    const texts = hostTexts(render(PULSE_LEGAL_LINES));
    expect(texts.map((t) => t.props.children)).toStrictEqual([AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER, MEDICAL_CONSULT_REMINDER]);
  });

  it('the band itself is not an accessibility group, so each line is its own accessibility node', () => {
    const tree = render([AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER]);
    expect(band(tree).props.accessible).not.toBe(true);
    expect(band(tree).props.accessibilityLabel).toBeUndefined();
  });
});

describe.each(FACES)('LegalNote — design contract on the %s face', (face) => {
  const C = colors[face];
  beforeEach(() => { forceFace(face); });

  it('the band is the AA-proven text scrim, token geometry, no border or elevation', () => {
    const s = flat(band(render([AI_DISCLOSURE_LONG])));
    expect(s.backgroundColor).toBe(textScrimFill(C, face));
    expect(s.paddingVertical).toBe(space.sm);
    expect(s.paddingHorizontal).toBe(space.lg);
    expect(s.borderRadius).toBe(radius.md);
    expect(s.borderWidth ?? 0).toBe(0);
    expect(s.elevation ?? 0).toBe(0);
    expect(s.shadowOpacity ?? 0).toBe(0);
  });

  it('every line is content.secondary, body size, regular weight, centred — never bold/italic/uppercase', () => {
    for (const t of hostTexts(render([AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER]))) {
      const s = flat(t);
      expect(s.color).toBe(C.content.secondary);
      expect(s.fontSize).toBe(typography.size.body);
      expect(s.fontWeight).toBe(typography.weight.regular);
      expect(s.lineHeight).toBe(typography.size.body * typography.leading.normal);
      expect(s.letterSpacing).toBe(typography.tracking.body);
      expect(s.textAlign).toBe('center');
      expect(s.fontStyle).toBeUndefined();
      expect(s.textTransform).toBeUndefined();
    }
  });
});

describe('LegalNote — nothing can truncate, hide, dismiss or animate it', () => {
  it('no numberOfLines / adjustsFontSizeToFit / low maxFontSizeMultiplier; font scaling stays on', () => {
    for (const t of hostTexts(render([AI_DISCLOSURE_LONG, MEDICAL_DISCLAIMER]))) {
      expect(t.props.numberOfLines).toBeUndefined();
      expect(t.props.ellipsizeMode).toBeUndefined();
      expect(t.props.adjustsFontSizeToFit).toBeUndefined();
      expect(t.props.maxFontSizeMultiplier).toBeUndefined();
      expect(t.props.allowFontScaling).not.toBe(false);
    }
  });

  it('no node hides from the accessibility tree, swallows touches, or announces as a live region', () => {
    for (const n of hostNodes(render([AI_DISCLOSURE_SHORT, MEDICAL_DISCLAIMER]))) {
      expect(n.props.pointerEvents).toBeUndefined();
      expect(n.props.accessibilityElementsHidden).toBeUndefined();
      expect(n.props.importantForAccessibility).toBeUndefined();
      expect(n.props.accessibilityLiveRegion).toBeUndefined();
      expect(n.props['aria-hidden']).toBeUndefined();
    }
  });

  it('has no control: nothing pressable, nothing to dismiss', () => {
    const tree = render([AI_DISCLOSURE_SHORT]);
    expect(tree.root.findAll((n) => typeof n.props.onPress === 'function')).toHaveLength(0);
    expect(tree.root.findAll((n) => n.props.accessibilityRole === 'button')).toHaveLength(0);
  });

  it('subscribes to nothing (no motion / keyboard listener that could leak, S10-1 / ATTACK-6)', () => {
    const a11y = jest.spyOn(AccessibilityInfo, 'addEventListener');
    const kb = jest.spyOn(Keyboard, 'addListener');
    const tree = render([AI_DISCLOSURE_LONG]);
    ReactTestRenderer.act(() => { tree.unmount(); });
    expect(a11y).not.toHaveBeenCalled();
    expect(kb).not.toHaveBeenCalled();
  });
});
