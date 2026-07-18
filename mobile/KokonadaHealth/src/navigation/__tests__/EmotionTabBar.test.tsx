import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { EmotionTabBar } from '../EmotionTabBar';
import { TAB_ROUTES, TAB_LABELS, type TabRoute } from '../tabRoutes';
import emotionReducer, { addTap } from '../../state/cold/emotionSlice';
import { colors } from '../../design/tokens';
import { contrastRatio, parseHex, flatten, AA_NORMAL, AA_LARGE } from '../../design/contrast';

// The active glyph paints over the emotionAccent[q].wash lozenge, not bare base — so the icon leg of
// the pin composites the wash (RGB + baked alpha) onto surface.base and judges what actually renders.
const toHex = ({ r, g, b }: { r: number; g: number; b: number }) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
const washOverBase = (washHex: string, baseHex: string) =>
  toHex(flatten(parseHex(washHex.slice(0, 7)), parseInt(washHex.slice(7, 9), 16) / 255, parseHex(baseHex)));

// EmotionTabBar is the CHROME that owns the reactive emotion subscription (a derived-primitive
// selector on the quadrant), so screens never re-render on an emotion change. This suite pins the
// steady-state tint, the AA-proven colour pairs, tab-change haptics, route order, and a11y roles.

// Deterministic theme (real useColorScheme flips async under jest, drifting dark↔light) so the
// tint — the thing under test — is the only variable. A dedicated test flips it to light.
jest.mock('../../design/theme', () => ({ useTheme: jest.fn() }));
import { useTheme } from '../../design/theme';

const DARK = colors.dark;
beforeEach(() => { (useTheme as jest.Mock).mockReturnValue({ name: 'dark', c: colors.dark }); });
const BOTTOM = 34;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: BOTTOM } };

function makeStore(taps: { x: number; y: number }[] = []) {
  const store = configureStore({ reducer: { emotion: emotionReducer } });
  taps.forEach((t) => store.dispatch(addTap(t)));
  return store;
}

// A minimal, faithful BottomTabBarProps: the router state (index + named routes), an empty
// descriptor map, and a navigation that records navigate() and answers emit() un-prevented.
function makeProps(index = 0) {
  const navigate = jest.fn();
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  const routes = TAB_ROUTES.map((name, i) => ({ key: `${name}-${i}`, name }));
  const descriptors = Object.fromEntries(routes.map((r) => [r.key, { options: {} }]));
  const state = { index, routes };
  return { props: { state, descriptors, navigation: { navigate, emit } } as unknown as BottomTabBarProps, navigate, emit };
}

async function render(store: ReturnType<typeof makeStore>, props: BottomTabBarProps, triggerHaptic = jest.fn()) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <Provider store={store}>
        <SafeAreaProvider initialMetrics={METRICS}>
          <EmotionTabBar {...props} triggerHaptic={triggerHaptic} />
        </SafeAreaProvider>
      </Provider>,
    );
  });
  return tree;
}

const flat = (node: any): Record<string, any> => {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
};
const host = (n: any) => typeof n.type === 'string';
// The Skia glyph Path is a composite stub whose `style` is the string 'fill' | 'stroke' (unique).
const fillGlyphs = (t: ReactTestRenderer.ReactTestRenderer) => t.root.findAll((n) => n.props?.style === 'fill');
const strokeGlyphs = (t: ReactTestRenderer.ReactTestRenderer) => t.root.findAll((n) => n.props?.style === 'stroke');
const label = (t: ReactTestRenderer.ReactTestRenderer, route: TabRoute) => t.root.findAll((n) => host(n) && n.props?.testID === `tab-label-${route}`)[0];
// The authored Pressable is the only 'tab' node carrying our onPress (Pressable handles press
// internally and never forwards onPress down), so this yields exactly the 5 tabs, each with the
// a11y props + press handler — Pressable's inner layers/host double are excluded.
const tabs = (t: ReactTestRenderer.ReactTestRenderer) => t.root.findAll((n) => n.props?.accessibilityRole === 'tab' && typeof n.props?.onPress === 'function');

describe('EmotionTabBar — emotion-tinted chrome', () => {
  it('(a) a fresh store (no taps) wears the brand CALM ink on the focused tab', async () => {
    const tree = await render(makeStore(), makeProps(0).props);
    const focused = fillGlyphs(tree);
    expect(focused).toHaveLength(1); // exactly the focused tab is filled
    expect(focused[0].props.color).toBe(DARK.emotionAccent.calm.ink);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(b) committed JOYFUL taps tint the focused tab with the joyful ink', async () => {
    const tree = await render(makeStore([{ x: 0.6, y: 0.6 }]), makeProps(0).props);
    expect(fillGlyphs(tree)[0].props.color).toBe(DARK.emotionAccent.joyful.ink);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(c) inactive tabs use content.secondary for the glyph (never the accent ink)', async () => {
    const tree = await render(makeStore([{ x: 0.6, y: 0.6 }]), makeProps(0).props);
    const inactive = strokeGlyphs(tree);
    expect(inactive).toHaveLength(4);
    for (const g of inactive) expect(g.props.color).toBe(DARK.content.secondary);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(d) the ACTIVE label is the accent ink; INACTIVE labels are content.secondary (content.*, not tint)', async () => {
    const tree = await render(makeStore([{ x: 0.6, y: 0.6 }]), makeProps(0).props);
    expect(flat(label(tree, 'Generate')).color).toBe(DARK.emotionAccent.joyful.ink); // active = ink
    expect(flat(label(tree, 'Pulse')).color).toBe(DARK.content.secondary);           // inactive = content.*
    expect(flat(label(tree, 'Pulse')).color).not.toBe(DARK.emotionAccent.joyful.ink);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(e) pressing an unfocused tab navigates to that route name', async () => {
    const { props, navigate } = makeProps(0);
    const tree = await render(makeStore(), props);
    await ReactTestRenderer.act(async () => { tabs(tree)[2].props.onPress(); }); // Pulse
    expect(navigate).toHaveBeenCalledWith('Pulse');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(f) CONTRAST PIN: active ink ≥3:1 over the wash lozenge + ≥AA-normal as a label; inactive secondary AA-normal (both themes)', () => {
    for (const t of [colors.dark, colors.light]) {
      for (const q of ['calm', 'joyful', 'intense', 'reflective'] as const) {
        // active ICON renders over the wash lozenge → composite it, judge against the 3:1 graphic floor
        expect(contrastRatio(t.emotionAccent[q].ink, washOverBase(t.emotionAccent[q].wash, t.surface.base))).toBeGreaterThanOrEqual(AA_LARGE);
        // active LABEL rides on bare base → text AA-normal
        expect(contrastRatio(t.emotionAccent[q].ink, t.surface.base)).toBeGreaterThanOrEqual(AA_NORMAL);
      }
      // inactive icon + label on bare base → AA-normal
      expect(contrastRatio(t.content.secondary, t.surface.base)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('(g) renders exactly 5 tabs in TAB_ROUTES order', async () => {
    const tree = await render(makeStore(), makeProps(0).props);
    const ids = tree.root.findAll((n) => host(n) && typeof n.props?.testID === 'string' && n.props.testID.startsWith('tab-icon-'))
      .map((n) => n.props.testID.replace('tab-icon-', ''));
    expect(ids).toEqual([...TAB_ROUTES]);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(h) haptics.selection fires on a tab CHANGE only — never re-firing the already-active tab', async () => {
    const trigger = jest.fn();
    const { props, navigate } = makeProps(0);
    const tree = await render(makeStore(), props, trigger);
    // pressing the already-active tab (index 0) → no change, no haptic, no navigate
    await ReactTestRenderer.act(async () => { tabs(tree)[0].props.onPress(); });
    expect(trigger).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    // pressing a different tab → one selection haptic + navigate
    await ReactTestRenderer.act(async () => { tabs(tree)[3].props.onPress(); }); // History
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('selection');
    expect(navigate).toHaveBeenCalledWith('History');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(i) a11y: tablist container, tab roles with selected state + WORD labels ("Now Playing")', async () => {
    const tree = await render(makeStore(), makeProps(1).props); // NowPlaying focused
    expect(tree.root.findAll((n) => host(n) && n.props?.accessibilityRole === 'tablist')).toHaveLength(1);
    const t = tabs(tree);
    expect(t).toHaveLength(5);
    expect(t[1].props.accessibilityState).toEqual({ selected: true });
    expect(t[0].props.accessibilityState).toEqual({ selected: false });
    expect(t[1].props.accessibilityLabel).toBe('Now Playing');
    expect(TAB_ROUTES.map((r) => TAB_LABELS[r])).toEqual(t.map((p) => p.props.accessibilityLabel));
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(j) the bar clears the bottom safe-area inset (home-indicator gap)', async () => {
    const tree = await render(makeStore(), makeProps(0).props);
    const container = tree.root.findAll((n) => host(n) && n.props?.accessibilityRole === 'tablist')[0];
    expect(flat(container).paddingBottom).toBeGreaterThanOrEqual(BOTTOM);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('(k) the LIGHT face flows through — focused ink + inactive secondary come from the light palette', async () => {
    (useTheme as jest.Mock).mockReturnValue({ name: 'light', c: colors.light });
    const tree = await render(makeStore(), makeProps(0).props); // calm (no taps)
    expect(fillGlyphs(tree)[0].props.color).toBe(colors.light.emotionAccent.calm.ink);
    for (const g of strokeGlyphs(tree)) expect(g.props.color).toBe(colors.light.content.secondary);
    expect(flat(label(tree, 'Pulse')).color).toBe(colors.light.content.secondary);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
