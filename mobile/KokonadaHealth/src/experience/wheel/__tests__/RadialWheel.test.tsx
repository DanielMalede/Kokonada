import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { RadialWheel } from '../RadialWheel';
import { hitsMostRecentDot, REMOVE_HIT_RADIUS } from '../wheelInteraction';
import { circumplexToScreen, type WheelLayout } from '../wheelGeometry';
import { colors, type ThemeName } from '../../../design/tokens';

// The Skia radial wheel, ELEVATED. Skia paint is verified on-device; here we attack the pure
// hit-test that routes a tap to undo-vs-add (§5 "tap a placed dot to remove") and the component's
// token disc + accent-ink dots. The gesture still commits with a SINGLE runOnJS on gesture-end,
// with geometry on the JS thread — that shipped-crash guard is unchanged (wheelGeometry untouched).

const layout: WheelLayout = { cx: 170, cy: 170, radius: 170 };
const tap = (x: number, y: number) => ({ x, y });

const findCircles = (tree: ReactTestRenderer.ReactTestRenderer, color: string) =>
  tree.root.findAll((n) => n.props?.color === color && typeof n.props?.r === 'number');
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

describe('RadialWheel — token disc + accent-ink dots', () => {
  it('paints tap dots in the passed emotion accent ink (all dots re-tint together)', () => {
    const tree = renderWith('dark',
      <RadialWheel size={340} committedTaps={[tap(0.3, 0.3), tap(-0.2, 0.5)]} onCommit={() => {}} accentInk="#C4A6FF" />);
    expect(findCircles(tree, '#C4A6FF').length).toBe(2); // one node per committed tap, all in ink
  });

  it('the disc gradient is token-sourced and differs light vs dark (no raw hex)', () => {
    const dark = findGradient(renderWith('dark',
      <RadialWheel size={340} committedTaps={[]} onCommit={() => {}} accentInk="#31E1C4" />)).props.colors;
    const light = findGradient(renderWith('light',
      <RadialWheel size={340} committedTaps={[]} onCommit={() => {}} accentInk="#0A7A6B" />)).props.colors;
    expect(dark).toEqual([colors.dark.surface.overlay, colors.dark.surface.base]);
    expect(light).toEqual([colors.light.surface.raised, colors.light.surface.overlay]);
  });

  it('renders no dots when there are no taps', () => {
    const tree = renderWith('dark',
      <RadialWheel size={340} committedTaps={[]} onCommit={() => {}} accentInk="#31E1C4" />);
    expect(findCircles(tree, '#31E1C4')).toHaveLength(0);
  });
});
