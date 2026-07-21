import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { RadialWheel } from '../RadialWheel';
import { hitsMostRecentDot, REMOVE_HIT_RADIUS } from '../wheelInteraction';
import { circumplexToScreen, type WheelLayout } from '../wheelGeometry';
import { colors, type ThemeName } from '../../../design/tokens';
import { auroraGlow } from '../../../design/emotionAccent';
import { contrastRatio, AA_LARGE } from '../../../design/contrast';

// The Skia radial wheel, ELEVATED. Skia paint is verified on-device; here we attack the pure
// hit-test that routes a tap to undo-vs-add (§5 "tap a placed dot to remove") and the component's
// token disc + accent-ink dots. The gesture still commits with a SINGLE runOnJS on gesture-end,
// with geometry on the JS thread — that shipped-crash guard is unchanged (wheelGeometry untouched).

const layout: WheelLayout = { cx: 170, cy: 170, radius: 170 };
const tap = (x: number, y: number) => ({ x, y });

const findCircles = (tree: ReactTestRenderer.ReactTestRenderer, color: string) =>
  tree.root.findAll((n) => n.props?.color === color && typeof n.props?.r === 'number');
const findFills = (tree: ReactTestRenderer.ReactTestRenderer, color: string) =>
  tree.root.findAll((n) => n.props?.color === color && typeof n.props?.r === 'number' && n.props?.style !== 'stroke');
const findStrokes = (tree: ReactTestRenderer.ReactTestRenderer, color: string) =>
  tree.root.findAll((n) => n.props?.color === color && n.props?.style === 'stroke');
const findGradient = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => Array.isArray(n.props?.colors))[0];

function renderWith(scheme: ThemeName, el: React.ReactElement) {
  jest.spyOn(RN, 'useColorScheme').mockReturnValue(scheme);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(el); });
  return tree;
}
afterEach(() => jest.restoreAllMocks());

describe('hitsMostRecentDot — §5 tap-a-placed-dot routes to undo (Fork 1b: most-recent is the target)', () => {
  it('an empty tap list is never a remove hit', () => {
    expect(hitsMostRecentDot(tap(170, 170), [], layout, REMOVE_HIT_RADIUS)).toBe(false);
  });

  it('a tap on the most-recent dot IS a remove hit', () => {
    const taps = [tap(-0.5, 0.5), tap(0.4, -0.4)]; // 0.4,-0.4 is most-recent
    const at = circumplexToScreen(taps[taps.length - 1], layout);
    expect(hitsMostRecentDot(at, taps, layout, REMOVE_HIT_RADIUS)).toBe(true);
  });

  it('a tap far from the most-recent dot (even on an OLDER dot) is NOT a remove hit', () => {
    const taps = [tap(-0.6, 0.6), tap(0.6, -0.6)]; // most-recent = 0.6,-0.6
    const onOlder = circumplexToScreen(taps[0], layout); // the older dot, opposite quadrant
    expect(hitsMostRecentDot(onOlder, taps, layout, REMOVE_HIT_RADIUS)).toBe(false);
  });

  it('a non-finite point never registers a remove hit (fails closed)', () => {
    const taps = [tap(0.4, -0.4)];
    expect(hitsMostRecentDot(tap(NaN, 10), taps, layout, REMOVE_HIT_RADIUS)).toBe(false);
  });

  it('the remove radius is a finger-friendly ≥44dp target', () => {
    expect(REMOVE_HIT_RADIUS).toBeGreaterThanOrEqual(44);
  });
});

describe('RadialWheel — frosted aurora-glass disc + per-dot glow + structural ring', () => {
  it('paints each tap dot in ITS OWN aurora glow, ringed by the session ink (fill decorative, ring structural)', () => {
    const taps = [tap(0.3, 0.3), tap(-0.2, 0.5)];
    const tree = renderWith('dark',
      <RadialWheel size={340} committedTaps={taps} onCommit={() => {}} accentInk="#C4A6FF" />);
    // each dot's soft FILL glows its own continuous emotion colour (distinct per tap)
    for (const t of taps) expect(findFills(tree, auroraGlow(t.x, t.y))).toHaveLength(1);
    // …and every dot carries a crisp structural RING in the session accent ink
    expect(findStrokes(tree, '#C4A6FF')).toHaveLength(taps.length);
  });

  it('the disc gradient is the frosted aurora glass — token-sourced, differs light vs dark (no raw hex)', () => {
    const dark = findGradient(renderWith('dark',
      <RadialWheel size={340} committedTaps={[]} onCommit={() => {}} accentInk="#31E1C4" />)).props.colors;
    const light = findGradient(renderWith('light',
      <RadialWheel size={340} committedTaps={[]} onCommit={() => {}} accentInk="#0A7A6B" />)).props.colors;
    expect(dark).toEqual([colors.dark.surface.overlay, colors.dark.surface.glassFallback]);
    expect(light).toEqual([colors.light.surface.raised, colors.light.surface.glassFallback]);
  });

  it('the dot RING clears AA-large against the frosted disc, every quadrant + both faces (structural cue)', () => {
    for (const name of ['dark', 'light'] as ThemeName[]) {
      const c = colors[name];
      const disc = name === 'light'
        ? [c.surface.raised, c.surface.glassFallback]
        : [c.surface.overlay, c.surface.glassFallback];
      for (const q of ['calm', 'joyful', 'intense', 'reflective'] as const) {
        for (const stop of disc) expect(contrastRatio(c.emotionAccent[q].ink, stop)).toBeGreaterThanOrEqual(AA_LARGE);
      }
    }
  });

  it('renders no dots when there are no taps', () => {
    const tree = renderWith('dark',
      <RadialWheel size={340} committedTaps={[]} onCommit={() => {}} accentInk="#31E1C4" />);
    expect(findCircles(tree, '#31E1C4')).toHaveLength(0);
  });
});
