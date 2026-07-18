import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// Deterministic theme + motion so colour + press assertions are exact.
jest.mock('../../../design/theme', () => ({ useTheme: jest.fn(), useMotion: jest.fn() }));

import { HistoryRow, PRESS_SCALE } from '../HistoryRow';
import { rowA11yLabel } from '../historyFormat';
import { useTheme, useMotion } from '../../../design/theme';
import { colors, motion, space } from '../../../design/tokens';
import type { SessionItem } from '../sessionsApi';

const DARK = colors.dark;
const NOW = new Date(2026, 6, 15, 14, 0, 0);

beforeEach(() => {
  (useTheme as jest.Mock).mockReturnValue({ name: 'dark', c: DARK });
  (useMotion as jest.Mock).mockReturnValue({ reduced: false, duration: motion.duration });
});

const item = (over: Partial<SessionItem> = {}): SessionItem => ({
  id: 'a', createdAt: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(), moodKey: 'bio:peak:running',
  source: 'live', activity: 'running', provider: 'spotify', contextPrompt: '', isFallback: false,
  skipCount: 0, trackCount: 2, tracks: [{ id: 't1', title: 'Song', artist: 'Artist' }], ...over,
});

function flatStyle(node: any): Record<string, unknown> {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}
const textOf = (node: any, acc: string[] = []): string[] => {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, acc)); return acc; }
  if (node.children) textOf(node.children, acc);
  return acc;
};
const allText = (t: ReactTestRenderer.ReactTestRenderer) => textOf(t.toJSON()).join(' ');
// Collapse the AnimatedPressable wrapper chain to the outermost logical button (the EmptyState
// precedent) — RTR surfaces one prop-carrying instance per wrapper, but there is one real button.
const button = (t: ReactTestRenderer.ReactTestRenderer) =>
  t.root.findAll((n) => n.props?.accessibilityRole === 'button' && n.parent?.props?.accessibilityRole !== 'button');
const medallion = (t: ReactTestRenderer.ReactTestRenderer) => t.root.findAll((n) => n.props?.testID === 'history-medallion')[0];

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  return tree;
}

describe('HistoryRow — one calm material moment', () => {
  it('exposes PRESS_SCALE = 0.985 (the only motion magic number, named + tested)', () => {
    expect(PRESS_SCALE).toBe(0.985);
  });

  it('is exactly ONE accessible button with the composed spoken label + replay hint', async () => {
    const it0 = item();
    const tree = await render(<HistoryRow item={it0} now={NOW} onPress={() => {}} />);
    const btns = button(tree);
    expect(btns).toHaveLength(1); // the whole card is the single tap target; children are not focusable
    expect(btns[0].props.accessibilityLabel).toBe(rowA11yLabel(it0, NOW));
    expect(btns[0].props.accessibilityLabel).toContain('Peak Energy'); // friendly, never the raw moodKey
    expect(btns[0].props.accessibilityHint).toBe('Opens this moment to replay its soundtrack.');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders the friendly title, the "Live · Running" meta and the relative time — never the raw key', async () => {
    const tree = await render(<HistoryRow item={item()} now={NOW} onPress={() => {}} />);
    const t = allText(tree);
    expect(t).toContain('Peak Energy');
    expect(t).toContain('Live · Running');
    expect(t).toContain('5m ago');
    expect(t).not.toContain('bio:'); // the raw moodKey never leaks
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('respects the card-contrast trap — primary title, secondary meta/time, NEVER tertiary on a raised card', async () => {
    const tree = await render(<HistoryRow item={item()} now={NOW} onPress={() => {}} />);
    const title = tree.root.findAll((n) => typeof n.type === 'string' && textOf(n).join('') === 'Peak Energy')[0];
    const meta = tree.root.findAll((n) => typeof n.type === 'string' && textOf(n).join('') === 'Live · Running')[0];
    const time = tree.root.findAll((n) => typeof n.type === 'string' && textOf(n).join('') === '5m ago')[0];
    expect(flatStyle(title).color).toBe(DARK.content.primary);
    expect(flatStyle(meta).color).toBe(DARK.content.secondary);
    expect(flatStyle(time).color).toBe(DARK.content.secondary);
    // tertiary is AA on base ONLY — it must never appear anywhere on the raised card.
    const used = new Set<string>();
    for (const n of tree.root.findAll(() => true)) {
      const st = flatStyle(n) as any;
      for (const k of ['color', 'backgroundColor', 'borderColor']) if (typeof st[k] === 'string') used.add(st[k]);
    }
    expect(used.has(DARK.content.tertiary)).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('is a raised card holding a decorative surface-overlay medallion (≥48dp target from padding, not a fixed height)', async () => {
    const tree = await render(<HistoryRow item={item()} now={NOW} onPress={() => {}} />);
    const card = flatStyle(button(tree)[0]);
    expect(card.backgroundColor).toBe(DARK.surface.raised);
    expect(card.padding).toBe(space.lg);
    expect(card.height).toBeUndefined(); // min-height derives from padding + medallion, never fixed
    const med = flatStyle(medallion(tree));
    expect(med.backgroundColor).toBe(DARK.surface.overlay);
    expect(med.width).toBe(space['2xl']); // 32 medallion + 2×16 padding = 64dp ≥ 48
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('press feedback is a reduced-safe fill shift: raised → overlay on press-in, back on press-out', async () => {
    const tree = await render(<HistoryRow item={item()} now={NOW} onPress={() => {}} />);
    expect(flatStyle(button(tree)[0]).backgroundColor).toBe(DARK.surface.raised);
    await ReactTestRenderer.act(async () => { button(tree)[0].props.onPressIn(); });
    expect(flatStyle(button(tree)[0]).backgroundColor).toBe(DARK.surface.overlay);
    await ReactTestRenderer.act(async () => { button(tree)[0].props.onPressOut(); });
    expect(flatStyle(button(tree)[0]).backgroundColor).toBe(DARK.surface.raised);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a tap opens THIS moment (calls onPress with the item)', async () => {
    const onPress = jest.fn();
    const it0 = item();
    const tree = await render(<HistoryRow item={it0} now={NOW} onPress={onPress} />);
    await ReactTestRenderer.act(async () => { button(tree)[0].props.onPress(); });
    expect(onPress).toHaveBeenCalledWith(it0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
