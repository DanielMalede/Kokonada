import React from 'react';
import { Text, View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

// Isolate EmptyState's own contract with a deterministic theme/motion (no async reduced flicker).
jest.mock('../../theme', () => ({ useTheme: jest.fn(), useMotion: jest.fn() }));

import { EmptyState, EMPTY_GLOW_OPACITY } from '../EmptyState';
import { useTheme, useMotion } from '../../theme';
import { colors, motion, type as typography } from '../../tokens';
import { contrastRatio, AA_NORMAL } from '../../contrast';

const DARK = colors.dark;

beforeEach(() => {
  (useTheme as jest.Mock).mockReturnValue({ name: 'dark', c: DARK });
  (useMotion as jest.Mock).mockReturnValue({ reduced: false, duration: motion.duration });
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

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

const ACTION = { label: 'Set a moment', onPress: () => {} };

describe('EmptyState — never a dead end', () => {
  it('exposes EMPTY_GLOW_OPACITY = 0.4 (the receding halo strength)', () => {
    expect(EMPTY_GLOW_OPACITY).toBe(0.4);
  });

  it('renders the title as a header, the body, and a required action button (label announced)', async () => {
    const onPress = jest.fn();
    const tree = await render(<EmptyState title="Nothing here yet" body="Your saved moments will appear here." action={{ label: 'Set a moment', onPress }} />);
    const h = header(tree);
    expect(textOf(h).join('')).toBe('Nothing here yet');
    expect(flatStyle(h).color).toBe(DARK.content.primary);
    expect(flatStyle(h).fontSize).toBe(typography.size.subheading);
    const all = textOf(tree.toJSON()).join(' ');
    expect(all).toContain('Your saved moments will appear here.');
    const cta = button(tree);
    expect(cta.props.accessibilityLabel).toBe('Set a moment');
    await ReactTestRenderer.act(async () => { cta.props.onPress(); });
    expect(onPress).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
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
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('brand tone (default): filled accent.glowInk CTA with content.onAccent label', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} />);
    const cta = flatStyle(button(tree));
    expect(cta.backgroundColor).toBe(DARK.accent.glowInk);
    expect(cta.borderColor).toBe(DARK.accent.glowInk);
    const label = tree.root.findAll((n) => isHost(n, 'Text') && textOf(n).join('') === ACTION.label)[0];
    expect(flatStyle(label).color).toBe(DARK.content.onAccent);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('quiet tone: outline CTA (content.tertiary border, NO accent fill) with emotion-accent ink label', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} tone="quiet" accentQuadrant="intense" />);
    const cta = flatStyle(button(tree));
    expect(cta.borderColor).toBe(DARK.content.tertiary);
    expect(cta.backgroundColor).toBeUndefined(); // never a fill (protects the onAccent AA guarantee)
    const label = tree.root.findAll((n) => isHost(n, 'Text') && textOf(n).join('') === ACTION.label)[0];
    expect(flatStyle(label).color).toBe(DARK.emotionAccent.intense.ink); // violet, never red
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('never renders a red/danger hue — high-arousal-negative resolves to violet (regulator ethic)', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} tone="quiet" accentQuadrant="intense" />);
    const used = collectColors(tree);
    expect(used.has(DARK.state.danger)).toBe(false);
    expect(used.has(colors.light.state.danger)).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the glyph sits in a still SoftGlow halo (accent.glow @ 0.4) and is hidden from assistive tech', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} />);
    const hidden = tree.root.findAll((n) => n.props?.accessibilityElementsHidden === true)[0];
    expect(hidden).toBeTruthy();
    expect(hidden.props.importantForAccessibility).toBe('no-hide-descendants');
    // SoftGlow paints a Skia circle in the brand accent, dimmed to the halo opacity
    expect(tree.root.findAll((n) => n.props?.color === DARK.accent.glow && typeof n.props?.r === 'number').length).toBeGreaterThan(0);
    expect(tree.root.findAll((n) => n.props?.opacity === EMPTY_GLOW_OPACITY).length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('accepts a consumer-supplied glyph (their compliance surface), replacing the default mark', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} glyph={<View testID="custom-glyph"><Text>icon</Text></View>} />);
    expect(tree.root.findAll((n) => n.props?.testID === 'custom-glyph').length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('is a polite status region — never role="alert" (an empty state is informational, not an alarm)', async () => {
    const tree = await render(<EmptyState title="t" action={ACTION} />);
    expect(root(tree)).toBeTruthy();
    expect(tree.root.findAll((n) => n.props?.accessibilityRole === 'alert')).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('reduced motion: entry snaps to opacity 1, same landmarks (byte-identical layout)', async () => {
    (useMotion as jest.Mock).mockReturnValue({ reduced: true, duration: motion.durationReduced });
    const tree = await render(<EmptyState title="Empty" body="b" action={ACTION} />);
    expect(readOpacity(flatStyle(root(tree)).opacity)).toBe(1);
    expect(header(tree)).toBeTruthy();
    expect(button(tree)).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('EmptyState — proven contrast contract (both themes)', () => {
  it('brand CTA: content.onAccent on accent.glowInk passes AA-normal', () => {
    for (const t of [colors.dark, colors.light]) {
      expect(contrastRatio(t.content.onAccent, t.accent.glowInk)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
  it('quiet CTA: every emotionAccent ink passes AA-normal on the base surface it renders over', () => {
    for (const t of [colors.dark, colors.light]) {
      for (const q of ['calm', 'joyful', 'intense', 'reflective'] as const) {
        expect(contrastRatio(t.emotionAccent[q].ink, t.surface.base)).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    }
  });
});
