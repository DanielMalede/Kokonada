import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { Linking, StyleSheet } from 'react-native';

jest.setTimeout(20000); // cold-require headroom for CI (compile time, not assertion time)

import { PrivacyPolicyLink } from '../PrivacyPolicyLink';
import { PRIVACY_POLICY_URL, PRIVACY_POLICY_LABEL, PRIVACY_POLICY_HINT, PRIVACY_POLICY_OPEN_FAILED } from '../legalLinks';
import { colors, space, type as typography, type ThemeName } from '../../design/tokens';
import { contrastRatio, AA_NORMAL } from '../../design/contrast';

// HX-5 (compliance brief M5, T5; designer direction Part 2). One quiet, underlined text link to the
// privacy policy, identical on every screen that carries it. It is a LINK (it leaves the app for the
// browser), never a button; it is a disclosure, never a commit; and it is never a dead end — if the
// browser cannot be opened, the address is shown as selectable text with the reason.

const openURL = Linking.openURL as jest.Mock;

// Forcing the face, the same way the ConsentSheet suite does: the preset's useColorScheme is a
// shared jest.fn, so capture its implementation and restore it by hand.
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
  openURL.mockReset();
  openURL.mockResolvedValue(true);
});

const flush = () => ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
async function render(el: React.ReactElement = <PrivacyPolicyLink />) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  mounted.push(tree);
  return tree;
}
// The outermost node carrying a testID (the composite that owns onPress and style).
const byTestId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id && n.parent?.props?.testID !== id);
const link = (tree: ReactTestRenderer.ReactTestRenderer) => byTestId(tree, 'privacy-policy-link')[0];
const hostTexts = (node: ReactTestRenderer.ReactTestInstance) => node.findAll((n) => (n.type as unknown) === 'Text');
const flat = (style: unknown) => (StyleSheet.flatten(style as any) ?? {}) as Record<string, any>;
const press = async (tree: ReactTestRenderer.ReactTestRenderer) => {
  await ReactTestRenderer.act(async () => { link(tree).props.onPress(); });
  await flush();
};
const texts = (tree: ReactTestRenderer.ReactTestRenderer) => hostTexts(tree.root).map((t) => t.props.children).flat().join(' ');

describe('PrivacyPolicyLink — what assistive technology and the reader are told', () => {
  it('is one link, named by its visible label, with a hint that it opens the browser', async () => {
    const tree = await render();
    const l = link(tree);
    expect(byTestId(tree, 'privacy-policy-link')).toHaveLength(1);
    expect(l.props.accessibilityRole).toBe('link');
    expect(l.props.accessibilityLabel).toBe(PRIVACY_POLICY_LABEL);
    expect(l.props.accessibilityHint).toBe(PRIVACY_POLICY_HINT);
    expect(l.props.accessibilityState).toEqual({ disabled: false });
    expect(hostTexts(l).map((t) => t.props.children)).toEqual([PRIVACY_POLICY_LABEL]);
  });

  it('is never a button, carries no image, no brand word and no "agree" framing', async () => {
    const tree = await render();
    expect(tree.root.findAll((n) => n.props.accessibilityRole === 'button')).toHaveLength(0);
    expect(tree.root.findAll((n) => (n.type as unknown) === 'Image')).toHaveLength(0);
    expect(texts(tree)).not.toMatch(/google|agree|accept|consent/i);
  });
});

describe('PrivacyPolicyLink — pressing it', () => {
  it('opens exactly the one address, once, in the browser', async () => {
    const tree = await render();
    await press(tree);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
    expect(byTestId(tree, 'privacy-policy-open-failed')).toHaveLength(0);
  });

  it('a rejected open never throws, and shows the reason and the address as selectable text', async () => {
    openURL.mockRejectedValue(new Error('No Activity found to handle Intent'));
    const tree = await render();
    await expect(press(tree)).resolves.toBeUndefined();
    const failed = byTestId(tree, 'privacy-policy-open-failed');
    expect(failed).toHaveLength(1);
    expect(hostTexts(failed[0]).map((t) => t.props.children)).toEqual([PRIVACY_POLICY_OPEN_FAILED, PRIVACY_POLICY_URL]);
    expect(byTestId(tree, 'privacy-policy-address')[0].props.selectable).toBe(true);
    expect(link(tree)).toBeDefined(); // the link stays, so a second try is one tap away
  });

  it('an open that throws synchronously is handled the same way', async () => {
    openURL.mockImplementation(() => { throw new Error('boom'); });
    const tree = await render();
    await expect(press(tree)).resolves.toBeUndefined();
    expect(byTestId(tree, 'privacy-policy-open-failed')).toHaveLength(1);
  });

  it('a later successful open clears the fallback', async () => {
    openURL.mockRejectedValueOnce(new Error('no browser'));
    const tree = await render();
    await press(tree);
    expect(byTestId(tree, 'privacy-policy-open-failed')).toHaveLength(1);
    await press(tree);
    expect(byTestId(tree, 'privacy-policy-open-failed')).toHaveLength(0);
  });

  it('disabled: announced as disabled, and a press (however it arrives) opens nothing', async () => {
    const tree = await render(<PrivacyPolicyLink disabled />);
    expect(link(tree).props.accessibilityState).toEqual({ disabled: true });
    expect(link(tree).props.disabled).toBe(true);
    await press(tree);
    expect(openURL).not.toHaveBeenCalled();
  });
});

describe('PrivacyPolicyLink — the designer’s exact treatment', () => {
  it('a real 48 x 48 dp target in the layout, with no hitSlop reaching over its neighbours', async () => {
    const tree = await render();
    const s = flat(link(tree).props.style);
    expect(s.minHeight).toBe(space['3xl']);
    expect(s.minWidth).toBe(space['3xl']);
    expect(space['3xl']).toBeGreaterThanOrEqual(48);
    expect(s.paddingHorizontal).toBe(space.none);
    expect(s.justifyContent).toBe('center');
    expect(s.alignItems).toBe('center');
    expect(link(tree).props.hitSlop).toBeUndefined();
  });

  it('footnote, regular, underlined, scaling with the system font and never truncated', async () => {
    const tree = await render();
    const label = hostTexts(link(tree))[0];
    const s = flat(label.props.style);
    expect(s.fontSize).toBe(typography.size.footnote);
    expect(s.fontWeight).toBe(typography.weight.regular);
    expect(s.lineHeight).toBe(typography.size.footnote * typography.leading.normal);
    expect(s.letterSpacing).toBe(typography.tracking.body);
    expect(s.textDecorationLine).toBe('underline');
    expect(label.props.allowFontScaling).not.toBe(false);
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.maxFontSizeMultiplier).toBeUndefined();
    expect(s.textAlign).toBeUndefined();
  });

  it('mirrors under RTL: no Left/Right style and no textAlign anywhere, fallback included', async () => {
    openURL.mockRejectedValue(new Error('no browser'));
    const tree = await render();
    await press(tree);
    const keys = tree.root.findAll((n) => typeof n.type === 'string').flatMap((n) => Object.keys(flat(n.props.style)));
    expect(keys.filter((k) => /Left|Right|^textAlign$/.test(k))).toEqual([]);
  });

  describe.each(['light', 'dark'] as ThemeName[])('colour on the %s face — never the emotion accent', (face) => {
    const C = colors[face];
    beforeEach(() => { forceFace(face); });
    const colourOf = (el: React.ReactElement<{ style: unknown }>) => flat(el.props.style).color;

    it('rest content.secondary, pressed content.primary, readable on both surfaces it sits on', async () => {
      const tree = await render();
      const render$ = link(tree).props.children as (s: { pressed: boolean; hovered: boolean }) => React.ReactElement<{ style: unknown }>;
      expect(colourOf(render$({ pressed: false, hovered: false }))).toBe(C.content.secondary);
      expect(colourOf(render$({ pressed: true, hovered: false }))).toBe(C.content.primary);
      for (const bg of [C.surface.base, C.surface.raised]) {
        expect(contrastRatio(C.content.secondary, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    });

    it('disabled content.tertiary (its documented "disabled" role), never an opacity literal', async () => {
      const tree = await render(<PrivacyPolicyLink disabled />);
      const render$ = link(tree).props.children as (s: { pressed: boolean; hovered: boolean }) => React.ReactElement<{ style: unknown }>;
      expect(colourOf(render$({ pressed: false, hovered: false }))).toBe(C.content.tertiary);
      expect(flat(link(tree).props.style).opacity).toBeUndefined();
    });
  });
});
