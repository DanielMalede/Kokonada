import React from 'react';
import * as RN from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MoodOnlyBar } from '../MoodOnlyBar';
import { createConnectStore } from '../connectStore';
import { colors, space, stroke, type ThemeName } from '../../../design/tokens';
import { contrastRatio, AA_NORMAL } from '../../../design/contrast';

// Designer REVISE guards for the pinned escape bar:
//  1. The glow-OUTLINE secondary's LABEL must be AA-normal on surface.base in BOTH themes —
//     accent.glow (3.88:1 in light) fails at 16dp/600, so the label is content.primary (proven AA),
//     while the 1.5px accent.glow BORDER stays (a 1.4.11 boundary, ≥3:1). No accent.glowInk on base.
//  2. The bar must clear the gesture-nav home indicator: paddingBottom = bottom safe-area inset +
//     space.xl, on BOTH the unresolved and resolved variants.

const INSET_BOTTOM = 34;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: INSET_BOTTOM } };
// Theme-agnostic sets (the jest env may resolve either face). The designer requirement holds in
// BOTH: the label is a content.primary (AA-normal on base everywhere), never an accent glow/glowInk
// (accent.glow fails AA-normal in the LIGHT theme); the ring is an accent.glow (a ≥3:1 boundary).
const PRIMARIES = [colors.light.content.primary, colors.dark.content.primary];
const GLOW_LABELS = [colors.light.accent.glow, colors.dark.accent.glow, colors.light.accent.glowInk, colors.dark.accent.glowInk];
const ACCENT_GLOWS = [colors.light.accent.glow, colors.dark.accent.glow];
// The RESOLVED bar's filled "Continue" is a standard primary CTA → the INK fill + its own label
// ink, never the aurora violet (which now only feeds the Generate hero's gradient). POSITIVE
// colour claims are pinned per FACE (see the describe.each below); only the NEGATIVE sets stay
// theme-spanning, because excluding a hue in BOTH faces is stronger than excluding it in one.
const GLOW_INKS = [colors.light.accent.glowInk, colors.dark.accent.glowInk];
const ON_ACCENTS = [colors.light.content.onAccent, colors.dark.content.onAccent];
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

function flatStyle(node: any): Record<string, any> {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}
const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label)[0];
const textNode = (tree: ReactTestRenderer.ReactTestRenderer, value: string) =>
  tree.root.findAll((n) => n.props.children === value)[0];
const barNode = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => n.props.testID === 'mood-only-bar')[0];

// Teardown discipline, per FILE rather than per call site. A failed assertion aborts the test body,
// so a trailing tree.unmount() never runs — and a leaked tree keeps its Animated work running into
// the NEXT test's window, failing that one too and hiding the real cause behind a cascade. Every
// render registers here and is swept unconditionally, pass or fail.
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const t of mounted.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
});

async function render(resolved: boolean) {
  const connect = createConnectStore(undefined, () => 'u1');
  if (resolved) connect.getState().markResolved();
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <MoodOnlyBar connect={connect} onMoodOnly={() => {}} onContinue={() => {}} />
      </SafeAreaProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

describe('MoodOnlyBar — AA label + bottom safe-area (designer REVISE)', () => {
  it('the mood-only LABEL is content.primary (AA on base), NEVER an accent glow/glowInk', async () => {
    const tree = await render(false);
    const label = flatStyle(textNode(tree, 'Continue with mood only'));
    expect(PRIMARIES).toContain(label.color);
    expect(GLOW_LABELS).not.toContain(label.color);
  });

  // ── FACE-FORCED colour pins ──────────────────────────────────────────────────────────────────
  // @react-native/jest-preset REPLACES react-native's useColorScheme with jest.fn(() => 'light'),
  // so an unforced render always resolves the LIGHT face — the shipping DARK face was never
  // rendered here at all. Asserting set-membership across a union of both faces therefore waved a
  // CROSS-FACE pairing through: hard-coding one face's ctaFill under the other face's label
  // measures ~1.08:1 (an invisible control) with every assertion still green. Forcing the scheme
  // runs the REAL useTheme → resolveScheme path in BOTH faces, pins each value EXACTLY, and
  // measures the rendered pair, so the class dies whichever call site is edited next.
  describe.each(FACES)('the resolved "Continue", rendered on the %s face', (scheme) => {
    const C = colors[scheme];
    beforeEach(() => { forceFace(scheme); });
    afterEach(() => { releaseFace(); });

    it('is THIS face’s ink fill under THIS face’s onCtaFill label, never the aurora violet', async () => {
      const tree = await render(true);
      const btn = flatStyle(byLabel(tree, 'continue-forward'));
      const label = flatStyle(textNode(tree, 'Continue'));
      expect(btn.backgroundColor).toBe(C.accent.ctaFill);
      expect(btn.borderColor).toBe(C.accent.ctaFill);
      expect(label.color).toBe(C.content.onCtaFill);
      expect(contrastRatio(label.color, btn.backgroundColor)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(GLOW_INKS).not.toContain(btn.backgroundColor);
      expect(ON_ACCENTS).not.toContain(label.color);
    });
  });

  it('the brand-glow BORDER is retained at the control stroke (an equal-weight secondary ring, not a fill)', async () => {
    const tree = await render(false);
    const btn = flatStyle(byLabel(tree, 'continue-mood-only'));
    expect(ACCENT_GLOWS).toContain(btn.borderColor);
    expect(btn.borderWidth).toBe(stroke.control);
    expect(btn.backgroundColor).toBe('transparent'); // outline, never a filled brand CTA here
  });

  it('the unresolved bar clears the home indicator: paddingBottom = inset.bottom + space.xl', async () => {
    const tree = await render(false);
    expect(flatStyle(barNode(tree)).paddingBottom).toBe(INSET_BOTTOM + space.xl);
  });

  it('the RESOLVED bar variant also respects the bottom safe-area inset', async () => {
    const tree = await render(true);
    expect(flatStyle(barNode(tree)).paddingBottom).toBe(INSET_BOTTOM + space.xl);
  });
});
