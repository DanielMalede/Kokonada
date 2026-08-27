import React from 'react';
import * as RN from 'react-native';
import { Text, View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

// Cold-require headroom for CI (same rationale as NowPlayingScreen/ConnectServicesScreen): on a
// cold babel cache the FIRST test in this file spends ~8s compiling the module graph and blows
// the 5s default. Pre-existing — the pre-change file times out identically. The budget being
// sized here is COMPILE time, not assertion time.
jest.setTimeout(20000);

// Only useMotion is stubbed — it is an ASYNC OS probe, and leaving it live makes the entry frame
// nondeterministic. useTheme stays REAL, so every render walks the same useColorScheme →
// resolveScheme path the app takes; the face is then FORCED per describe below. Mocking the whole
// theme module (as this file used to) pinned a face by fiat: resolveScheme never ran, and the
// light face — the one @react-native/jest-preset actually resolves — was never rendered at all.
jest.mock('../../theme', () => ({ ...jest.requireActual('../../theme'), useMotion: jest.fn() }));

import { EmptyState, EMPTY_GLOW_OPACITY } from '../EmptyState';
import { useMotion } from '../../theme';
import { colors, motion, type as typography, type ThemeName, type EmotionQuadrant } from '../../tokens';
import { contrastRatio, AA_NORMAL } from '../../contrast';

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
const QUADRANTS: EmotionQuadrant[] = ['calm', 'joyful', 'intense', 'reflective'];

beforeEach(() => {
  (useMotion as jest.Mock).mockReturnValue({ reduced: false, duration: motion.duration });
});

// Teardown discipline, per FILE rather than per call site. A failed assertion aborts the test body,
// so a trailing tree.unmount() never runs — and EmptyState starts a 420ms Animated.timing on EVERY
// mount, which then ticks inside the next test's window. Every render registers here and is swept
// unconditionally, pass or fail.
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const t of mounted.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
  releaseFace();
});

function flatStyle(node: any): Record<string, unknown> {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}
const readOpacity = (v: unknown): unknown => (typeof v === 'number' ? v : v && typeof (v as any).__getValue === 'function' ? (v as any).__getValue() : v);
const isHost = (n: any, name: string): boolean => typeof n.type === 'string' && n.type === name;
const textOf = (node: any, acc: string[] = []): string[] => {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, acc)); return acc; }
  if (node.children) textOf(node.children, acc);
  return acc;
};
const collectColors = (tree: ReactTestRenderer.ReactTestRenderer): Set<string> => {
  const acc = new Set<string>();
  for (const n of tree.root.findAll(() => true)) {
    const st = flatStyle(n) as any;
    for (const k of ['backgroundColor', 'borderColor', 'color', 'shadowColor']) if (typeof st[k] === 'string') acc.add(st[k]);
    if (typeof n.props?.color === 'string') acc.add(n.props.color);
  }
  return acc;
};
const root = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => n.props?.accessibilityLiveRegion === 'polite' && typeof n.type === 'string')[0];
const button = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => n.props?.accessibilityRole === 'button' && n.parent?.props?.accessibilityRole !== 'button')[0];
const header = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => n.props?.accessibilityRole === 'header')[0];
const ctaLabel = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => isHost(n, 'Text') && textOf(n).join('') === ACTION.label)[0];

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  mounted.push(tree);
  return tree;
}

const ACTION = { label: 'Set a moment', onPress: () => {} };

it('exposes EMPTY_GLOW_OPACITY = 0.4 (the receding halo strength)', () => {
  expect(EMPTY_GLOW_OPACITY).toBe(0.4);
});

describe.each(FACES)('EmptyState — never a dead end (%s face)', (scheme) => {
  const C = colors[scheme];
  beforeEach(() => { forceFace(scheme); });

  it('renders the title as a header, the body, and a required action button (label announced)', async () => {
    const onPress = jest.fn();
    const tree = await render(<EmptyState title="Nothing here yet" body="Your saved moments will appear here." action={{ label: 'Set a moment', onPress }} />);
    const h = header(tree);
    expect(textOf(h).join('')).toBe('Nothing here yet');
    expect(flatStyle(h).color).toBe(C.content.primary);
    expect(flatStyle(h).fontSize).toBe(typography.size.subheading);
    const all = textOf(tree.toJSON()).join(' ');
    expect(all).toContain('Your saved moments will appear here.');
    const cta = button(tree);
    expect(cta.props.accessibilityLabel).toBe('Set a moment');
    await ReactTestRenderer.act(async () => { cta.props.onPress(); });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('focus order is title → body → CTA', async () => {
    const tree = await render(<EmptyState title="Empty" body="Some body copy." action={ACTION} />);
    const order = tree.root.findAll(() => true);
    const idxHeader = order.indexOf(header(tree));
    const bodyNode = tree.root.findAll((n) => isHost(n, 'Text') && textOf(n).join('') === 'Some body copy.')[0];
    const idxBody = order.indexOf(bodyNode);
    const idxCta = order.indexOf(button(tree));
    expect(idxHeader).toBeLessThan(idxBody);
    expect(idxBody).toBeLessThan(idxCta);
  });

  it('brand tone (default): filled accent.ctaFill CTA with content.onCtaFill label', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} />);
    const cta = flatStyle(button(tree));
    expect(cta.backgroundColor).toBe(C.accent.ctaFill);
    expect(cta.borderColor).toBe(C.accent.ctaFill);
    expect(flatStyle(ctaLabel(tree)).color).toBe(C.content.onCtaFill);
    // Fill and label are proven to belong to the SAME face by measurement, not by membership in a
    // union that spans both — a cross-face pair would measure ~1.09:1 and still be "a CTA colour".
    expect(contrastRatio(flatStyle(ctaLabel(tree)).color as string, cta.backgroundColor as string)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  // The brand fill is FIXED across every quadrant. accentQuadrant is LIVE API on the brand tone —
  // PulseScreen ships tone="brand" and accentQuadrant together — so a re-tint is one edit away, and
  // it would silently void the AA proof: content.onCtaFill is proven against accent.ctaFill ONLY,
  // never against an emotion ink. Asserting the default quadrant alone left three of four unpinned.
  it.each(QUADRANTS)('brand tone with accentQuadrant=%s still wears accent.ctaFill — never the emotion ink', async (q) => {
    const tree = await render(<EmptyState title="t" action={ACTION} tone="brand" accentQuadrant={q} />);
    const cta = flatStyle(button(tree));
    const label = flatStyle(ctaLabel(tree));
    expect(cta.backgroundColor).toBe(C.accent.ctaFill);
    expect(cta.borderColor).toBe(C.accent.ctaFill);
    expect(label.color).toBe(C.content.onCtaFill);
    expect(cta.backgroundColor).not.toBe(C.emotionAccent[q].ink);
    expect(cta.borderColor).not.toBe(C.emotionAccent[q].ink);
    expect(label.color).not.toBe(C.emotionAccent[q].ink);
    expect(contrastRatio(label.color as string, cta.backgroundColor as string)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  // The INVERTED pin: the standard CTA used to wear the aurora violet (accent.glowInk / onAccent).
  // glowInk is still a live token — it feeds the Generate hero's gradient — so "gone" has to be
  // asserted, not inferred from its absence. Excluded in BOTH faces, not just the rendered one.
  it('the standard CTA no longer wears the aurora violet (glowInk/onAccent are gone from it)', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} />);
    const cta = flatStyle(button(tree));
    const glowInks = [colors.light.accent.glowInk, colors.dark.accent.glowInk];
    const onAccents = [colors.light.content.onAccent, colors.dark.content.onAccent];
    expect(glowInks).not.toContain(cta.backgroundColor);
    expect(glowInks).not.toContain(cta.borderColor);
    expect(onAccents).not.toContain(flatStyle(ctaLabel(tree)).color);
  });

  it('quiet tone: outline CTA (content.tertiary border, NO accent fill) with emotion-accent ink label', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} tone="quiet" accentQuadrant="intense" />);
    const cta = flatStyle(button(tree));
    expect(cta.borderColor).toBe(C.content.tertiary);
    expect(cta.backgroundColor).toBeUndefined(); // never a fill (protects the onCtaFill AA guarantee)
    expect(flatStyle(ctaLabel(tree)).color).toBe(C.emotionAccent.intense.ink); // violet, never red
  });

  it('never renders a red/danger hue — high-arousal-negative resolves to violet (regulator ethic)', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} tone="quiet" accentQuadrant="intense" />);
    const used = collectColors(tree);
    expect(used.has(colors.dark.state.danger)).toBe(false);
    expect(used.has(colors.light.state.danger)).toBe(false);
  });

  it('the glyph sits in a still SoftGlow halo (accent.glow @ 0.4) and is hidden from assistive tech', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} />);
    const hidden = tree.root.findAll((n) => n.props?.accessibilityElementsHidden === true)[0];
    expect(hidden).toBeTruthy();
    expect(hidden.props.importantForAccessibility).toBe('no-hide-descendants');
    // SoftGlow paints a Skia circle in the brand accent, dimmed to the halo opacity
    expect(tree.root.findAll((n) => n.props?.color === C.accent.glow && typeof n.props?.r === 'number').length).toBeGreaterThan(0);
    expect(tree.root.findAll((n) => n.props?.opacity === EMPTY_GLOW_OPACITY).length).toBeGreaterThan(0);
  });

  it('accepts a consumer-supplied glyph (their compliance surface), replacing the default mark', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} glyph={<View testID="custom-glyph"><Text>icon</Text></View>} />);
    expect(tree.root.findAll((n) => n.props?.testID === 'custom-glyph').length).toBeGreaterThan(0);
  });

  it('is a polite status region — never role="alert" (an empty state is informational, not an alarm)', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} />);
    expect(root(tree)).toBeTruthy();
    expect(tree.root.findAll((n) => n.props?.accessibilityRole === 'alert')).toHaveLength(0);
  });

  it('reduced motion: entry snaps to opacity 1, same landmarks (byte-identical layout)', async () => {
    (useMotion as jest.Mock).mockReturnValue({ reduced: true, duration: motion.durationReduced });
    const tree = await render(<EmptyState title="Empty" body="b" action={ACTION} />);
    expect(readOpacity(flatStyle(root(tree)).opacity)).toBe(1);
    expect(header(tree)).toBeTruthy();
    expect(button(tree)).toBeTruthy();
  });
});

describe('EmptyState — proven contrast contract (both themes)', () => {
  it('brand CTA: content.onCtaFill on accent.ctaFill passes AA-normal', () => {
    for (const t of [colors.dark, colors.light]) {
      expect(contrastRatio(t.content.onCtaFill, t.accent.ctaFill)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
  it('quiet CTA: every emotionAccent ink passes AA-normal on the base surface it renders over', () => {
    for (const t of [colors.dark, colors.light]) {
      for (const q of QUADRANTS) {
        expect(contrastRatio(t.emotionAccent[q].ink, t.surface.base)).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    }
  });
});
