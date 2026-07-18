import React from 'react';
import { ActivityIndicator, AccessibilityInfo } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const mockFetchSessions = jest.fn();
jest.mock('../sessionsApi', () => ({ fetchSessions: (...a: any[]) => mockFetchSessions(...a) }));
const fetchSessions = mockFetchSessions;

import { HistoryScreen } from '../HistoryScreen';
import type { SessionItem } from '../sessionsApi';
import { colors } from '../../../design/tokens';

const DARK = colors.dark;
// Production wraps the app in a SafeAreaProvider; supply one (zero insets) for the headless renderer.
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
const allText = (t: ReactTestRenderer.ReactTestRenderer) => texts(t.toJSON()).join(' ');
const flatStyle = (node: any): Record<string, unknown> => {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
};
const readAnim = (v: unknown): unknown => (v && typeof (v as any).__getValue === 'function' ? (v as any).__getValue() : v);
const byLabel = (t: ReactTestRenderer.ReactTestRenderer, label: string) =>
  t.root.findAll((n) => n.props?.accessibilityLabel === label && n.parent?.props?.accessibilityLabel !== label);
const rowButtons = (t: ReactTestRenderer.ReactTestRenderer) =>
  t.root.findAll((n) => n.props?.accessibilityRole === 'button'
    && n.props?.accessibilityHint === 'Opens this moment to replay its soundtrack.'
    && n.parent?.props?.accessibilityRole !== 'button');
const list = (t: ReactTestRenderer.ReactTestRenderer) =>
  t.root.findAll((n) => n.props?.testID === 'history-list' && typeof n.props?.onEndReached === 'function')[0];
const usedColors = (t: ReactTestRenderer.ReactTestRenderer): Set<string> => {
  const acc = new Set<string>();
  for (const n of t.root.findAll(() => true)) {
    const st = flatStyle(n) as any;
    for (const k of ['color', 'backgroundColor', 'borderColor']) if (typeof st[k] === 'string') acc.add(st[k]);
    if (typeof n.props?.color === 'string') acc.add(n.props.color);
  }
  return acc;
};

const item = (id: string, over: Partial<SessionItem> = {}): SessionItem => ({
  id, createdAt: new Date().toISOString(), moodKey: 'bio:peak:running', source: 'live', activity: 'running',
  provider: 'spotify', contextPrompt: '', isFallback: false, skipCount: 0, trackCount: 2,
  tracks: [{ id: 't1', title: 'Song A', artist: 'Artist A' }], ...over,
});

async function render(props: Partial<React.ComponentProps<typeof HistoryScreen>> = {}) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={METRICS}><HistoryScreen {...props} /></SafeAreaProvider>,
    );
  });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

beforeEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

describe('HistoryScreen — the quiet archive (§9)', () => {
  it('state-stable frame — the "History" header renders identically across loading, empty, error and list', async () => {
    fetchSessions.mockImplementation(() => new Promise(() => {}));
    const loading = await render();
    expect(allText(loading)).toContain('History');
    await ReactTestRenderer.act(async () => { loading.unmount(); });

    fetchSessions.mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } });
    const empty = await render();
    expect(allText(empty)).toContain('History');
    await ReactTestRenderer.act(async () => { empty.unmount(); });

    fetchSessions.mockResolvedValue({ ok: false, status: 500, error: 'server down' });
    const errored = await render();
    expect(allText(errored)).toContain('History'); // the header never moves, even on error
    await ReactTestRenderer.act(async () => { errored.unmount(); });

    fetchSessions.mockResolvedValue({ ok: true, data: { items: [item('a')], nextCursor: null } });
    const loaded = await render();
    expect(allText(loaded)).toContain('History');
    await ReactTestRenderer.act(async () => { loaded.unmount(); });
  });

  it('first page shows a breathing skeleton (never a spinner) and never flashes the empty state before the first response resolves', async () => {
    fetchSessions.mockImplementation(() => new Promise(() => {})); // never resolves
    const tree = await render();
    expect(byLabel(tree, 'Loading your moments').length).toBeGreaterThan(0); // the skeleton container
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);      // no spinner, ever
    expect(allText(tree)).not.toContain('Your moments will live here');       // empty-flash guarded
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a confirmed-empty response shows the never-dead-end EmptyState with a Generate CTA', async () => {
    fetchSessions.mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } });
    const onGenerate = jest.fn();
    const tree = await render({ onGenerate });
    const t = allText(tree);
    expect(t).toContain('Your moments will live here');
    expect(t).toContain("Generate a soundtrack and it'll be saved here to revisit anytime.");
    const cta = byLabel(tree, 'Generate a soundtrack');
    expect(cta.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { cta[0].props.onPress(); });
    expect(onGenerate).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a first-load error shows a NON-ALARM EmptyState (Try again, never red) and retries on tap', async () => {
    fetchSessions.mockResolvedValue({ ok: false, status: 500, error: 'server down' });
    const tree = await render();
    const t = allText(tree);
    expect(t).toContain("We couldn't load your moments");
    expect(t).toContain('Check your connection and try again.');
    expect(t).not.toContain('server down'); // raw error string never surfaced as body
    const used = usedColors(tree);
    expect(used.has(DARK.state.danger)).toBe(false);
    expect(used.has(colors.light.state.danger)).toBe(false);
    fetchSessions.mockClear();
    const retry = byLabel(tree, 'Try again');
    expect(retry.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { retry[0].props.onPress(); await new Promise((r) => setImmediate(r)); });
    expect(fetchSessions).toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('renders loaded moments as friendly cards — never a raw moodKey, calm relative time', async () => {
    const createdAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    fetchSessions.mockResolvedValue({ ok: true, data: { items: [item('a', { createdAt })], nextCursor: null } });
    const tree = await render();
    const t = allText(tree);
    expect(t).toContain('Peak Energy');
    expect(t).toContain('Live · Running');
    expect(t).toContain('5m ago');
    expect(t).not.toContain('bio:');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('keeps the list intact on a failed load-more and shows a quiet non-alarm footer note (no red)', async () => {
    fetchSessions
      .mockResolvedValueOnce({ ok: true, data: { items: [item('a')], nextCursor: { before: 'x', beforeId: 'a' } } })
      .mockResolvedValueOnce({ ok: false, status: 500, error: 'boom' });
    const tree = await render();
    expect(allText(tree)).toContain('Peak Energy');
    await ReactTestRenderer.act(async () => { list(tree).props.onEndReached(); await new Promise((r) => setImmediate(r)); });
    const t = allText(tree);
    expect(t).toContain('Peak Energy'); // list never blanked
    expect(t).toContain('Couldn’t load more — pull to retry');
    expect(usedColors(tree).has(DARK.state.danger)).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('at the end of the feed shows the calm "You’re all caught up" (silent end, no loading footer)', async () => {
    fetchSessions.mockResolvedValue({ ok: true, data: { items: [item('a')], nextCursor: null } });
    const tree = await render();
    expect(allText(tree)).toContain('You’re all caught up');
    expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('tints the pull-to-refresh with the brand accent (not an in-content spinner)', async () => {
    fetchSessions.mockResolvedValue({ ok: true, data: { items: [item('a')], nextCursor: null } });
    const tree = await render();
    const rc = list(tree).props.refreshControl;
    // Theme-agnostic (the headless renderer may resolve either scheme): the pull-to-refresh is tinted
    // with the ACTIVE theme's brand accent, and its Android track sits on surface.raised.
    expect([DARK.accent.glow, colors.light.accent.glow]).toContain(rc.props.tintColor);
    expect(rc.props.colors[0]).toBe(rc.props.tintColor);
    expect([DARK.surface.raised, colors.light.surface.raised]).toContain(rc.props.progressBackgroundColor);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a row tap opens that moment (onOpenSession with the item)', async () => {
    const it0 = item('a');
    fetchSessions.mockResolvedValue({ ok: true, data: { items: [it0], nextCursor: null } });
    const onOpenSession = jest.fn();
    const tree = await render({ onOpenSession });
    await ReactTestRenderer.act(async () => { rowButtons(tree)[0].props.onPress(); });
    expect(onOpenSession).toHaveBeenCalledWith(it0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('reduced motion — the list container settles at rest (opacity 1, no translate), layout unchanged', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    let resolveFetch!: (v: any) => void;
    fetchSessions.mockImplementation(() => new Promise((r) => { resolveFetch = r; }));
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SafeAreaProvider initialMetrics={METRICS}><HistoryScreen /></SafeAreaProvider>,
      );
    });
    await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); }); // reduced settles true first
    await ReactTestRenderer.act(async () => { resolveFetch({ ok: true, data: { items: [item('a')], nextCursor: null } }); await new Promise((r) => setImmediate(r)); });
    const container = tree.root.findAll((n) => n.props?.testID === 'history-list-container')[0];
    const st = flatStyle(container) as any;
    expect(readAnim(st.opacity)).toBe(1);
    const ty = Array.isArray(st.transform) ? (st.transform.find((x: any) => 'translateY' in x) || {}).translateY : undefined;
    expect(readAnim(ty)).toBe(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('does not update state after unmount (no post-unmount setState)', async () => {
    let resolve!: (v: any) => void;
    fetchSessions.mockImplementation(() => new Promise((r) => { resolve = r; }));
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SafeAreaProvider initialMetrics={METRICS}><HistoryScreen /></SafeAreaProvider>,
      );
    });
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    await ReactTestRenderer.act(async () => { resolve({ ok: true, data: { items: [item('late')], nextCursor: null } }); await Promise.resolve(); });
  });
});
