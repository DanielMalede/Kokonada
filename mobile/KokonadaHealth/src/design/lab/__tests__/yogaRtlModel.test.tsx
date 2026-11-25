import React from 'react';
import { View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { frameOf, layoutRules, type Box, type Rules } from './__fixtures__/yogaRtl';

// UI-242: the lab's RTL tests share one layout model (__fixtures__/yogaRtl.ts), so it is pinned here on small trees whose
// layout React Native's own rules decide: Fabric turns `left` into `start` and `right` into `end` under RTL
// (swapLeftAndRightInYogaStyleProps, I18nManager.doLeftAndRightSwapInRTL), Yoga resolves an absolute child's start and
// end by its containing node's direction (AbsoluteLayout.cpp: layoutAbsoluteChild takes the current node's direction),
// lays a row out from its start edge, places a child with a width at the cross-start edge of a stretching column, and a
// node's `direction` style holds for its children unless one sets its own. A style the model does not know is an error.

const STAGE: Box = { x: 0, y: 0, width: 400, height: 800 };
const RTL: Rules = { swap: true, rootDir: 'rtl' };
const LTR: Rules = { swap: false, rootDir: 'ltr' };

function frames(tree: React.ReactElement, rules: Rules): Record<string, Box> {
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => { r = ReactTestRenderer.create(tree); });
  const out: Record<string, Box> = {};
  for (const n of r.root.findAll((x) => typeof x.type === 'string' && typeof x.props.testID === 'string')) out[n.props.testID] = frameOf(n, STAGE, rules);
  return out;
}

describe('the shared Yoga RTL model', () => {
  it('an absolute View at left: 10 lands at x 10 in LTR, mirrored under RTL with the swap', () => {
    const tree = <View testID="root" style={{ flex: 1 }}><View testID="a" style={{ position: 'absolute', left: 10, top: 20, width: 30, height: 40 }} /></View>;
    expect(frames(tree, LTR).a).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(frames(tree, RTL).a).toEqual({ x: 400 - 10 - 30, y: 20, width: 30, height: 40 });
    // Without the swap, left stays physical whatever the direction.
    expect(frames(tree, { swap: false, rootDir: 'rtl' }).a).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('a `direction: ltr` on an ancestor pins it; on the absolute View itself it does not (its parent\'s direction decides)', () => {
    const pinned = <View style={{ flex: 1, direction: 'ltr' }}><View testID="a" style={{ position: 'absolute', left: 10, top: 0, width: 30, height: 40 }} /></View>;
    expect(frames(pinned, RTL).a.x).toBe(10);
    const own = <View style={{ flex: 1 }}><View testID="a" style={{ position: 'absolute', left: 10, top: 0, width: 30, height: 40, direction: 'ltr' }} /></View>;
    expect(frames(own, RTL).a.x).toBe(400 - 10 - 30);
  });

  it('absolute fill and right: right is end, so it mirrors too', () => {
    const tree = (
      <View style={{ flex: 1 }}>
        <View testID="fill" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
        <View testID="r" style={{ position: 'absolute', right: 5, bottom: 6, width: 10, height: 10 }} />
      </View>
    );
    expect(frames(tree, LTR)).toEqual({ fill: STAGE, r: { x: 385, y: 784, width: 10, height: 10 } });
    expect(frames(tree, RTL)).toEqual({ fill: STAGE, r: { x: 5, y: 784, width: 10, height: 10 } });
  });

  it('a row runs from its start edge: left to right in LTR, right to left under RTL, and pinned by an ltr ancestor', () => {
    const row = (dir?: 'ltr') => (
      <View style={{ flex: 1, ...(dir ? { direction: dir } : {}) }}>
        <View style={{ flexDirection: 'row' }}>
          <View testID="one" style={{ width: 100, height: 50 }} />
          <View testID="two" style={{ width: 120, height: 50 }} />
        </View>
      </View>
    );
    expect([frames(row(), LTR).one.x, frames(row(), LTR).two.x]).toEqual([0, 100]);
    expect([frames(row(), RTL).one.x, frames(row(), RTL).two.x]).toEqual([300, 180]);
    expect([frames(row('ltr'), RTL).one.x, frames(row('ltr'), RTL).two.x]).toEqual([0, 100]);
  });

  it('a column stacks its children from the top; a sized child sits at the cross-start edge (the right under RTL); centre centres', () => {
    const tree = (
      <View style={{ flex: 1 }}>
        <View testID="top" style={{ width: 100, height: 50 }} />
        <View testID="rest" style={{ flex: 1 }} />
      </View>
    );
    expect(frames(tree, LTR)).toEqual({ top: { x: 0, y: 0, width: 100, height: 50 }, rest: { x: 0, y: 50, width: 400, height: 750 } });
    expect(frames(tree, RTL).top).toEqual({ x: 300, y: 0, width: 100, height: 50 });
    const centred = <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><View testID="c" style={{ width: 100, height: 60 }} /></View>;
    expect(frames(centred, RTL).c).toEqual({ x: 150, y: 370, width: 100, height: 60 });
    expect(frames(centred, LTR).c).toEqual({ x: 150, y: 370, width: 100, height: 60 });
  });

  // F10 G8: the hero's bead draws its disc and its setting ring as Views placed by their sides, with a corner radius, a
  // border, a shadow and a background image (the bead's own tokens here); none of those may stop the model, and none may
  // move what they paint.
  const bead = DIRECTIONS.abyss.bead;
  const ink = DIRECTIONS.abyss.color.dark.text.primary.hex;
  const B = bead.setting.width;

  it('a paint-only style moves nothing: a corner radius, a border colour, a shadow and a background image', () => {
    const paint = {
      borderRadius: bead.diameter / 2, borderColor: ink, boxShadow: [{ offsetX: 0, offsetY: bead.shadow.offsetY, blurRadius: bead.shadow.blur, color: ink }],
      experimental_backgroundImage: [{ type: 'radial-gradient', colorStops: [] }],
    };
    const tree = <View style={{ flex: 1 }}><View testID="p" style={{ position: 'absolute', left: 10, top: 20, width: 30, height: 40, ...paint }} /></View>;
    expect(frames(tree, LTR).p).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(frames(tree, RTL).p).toEqual({ x: 400 - 10 - 30, y: 20, width: 30, height: 40 });
  });

  it('a uniform border leaves its node where it is and lays its children inside it, absolute and in flow alike', () => {
    const tree = (
      <View style={{ flex: 1 }}>
        <View testID="b" style={{ position: 'absolute', left: 10, top: 20, width: 100, height: 100, borderWidth: B }}>
          <View testID="abs" style={{ position: 'absolute', left: 5, top: 6, width: 10, height: 10 }} />
          <View testID="flow" style={{ width: 20, height: 30 }} />
        </View>
      </View>
    );
    expect(frames(tree, LTR)).toEqual({
      b: { x: 10, y: 20, width: 100, height: 100 },
      abs: { x: 10 + B + 5, y: 20 + B + 6, width: 10, height: 10 },
      flow: { x: 10 + B, y: 20 + B, width: 20, height: 30 },
    });
    // Under RTL the bordered box mirrors, and its children resolve start and end inside the border, from its right edge.
    expect(frames(tree, RTL)).toEqual({
      b: { x: 290, y: 20, width: 100, height: 100 },
      abs: { x: 290 + 100 - B - 5 - 10, y: 20 + B + 6, width: 10, height: 10 },
      flow: { x: 290 + 100 - B - 20, y: 20 + B, width: 20, height: 30 },
    });
  });

  it('fails closed on a border it does not model: one side\'s width, or a width that is not a number', () => {
    const side = <View style={{ flex: 1 }}><View testID="s" style={{ position: 'absolute', left: 0, top: 0, width: 10, height: 10, borderLeftWidth: B }} /></View>;
    expect(() => frames(side, LTR)).toThrow(/unmodelled style.*borderLeftWidth/);
    const text = <View style={{ flex: 1 }}><View testID="t" style={{ position: 'absolute', left: 0, top: 0, width: 10, height: 10, borderWidth: String(B) as never }} /></View>;
    expect(() => frames(text, LTR)).toThrow(/unmodelled style.*borderWidth/);
  });

  it('fails closed: a style it does not model is an error, never a guess', () => {
    const margin = <View style={{ flex: 1 }}><View testID="m" style={{ aspectRatio: 1, width: 10 }} /></View>;
    expect(() => frames(margin, RTL)).toThrow(/unmodelled style/);
    const unsized = <View style={{ flex: 1 }}><View testID="u" style={{ position: 'absolute', left: 4, top: 0 }} /></View>;
    expect(() => frames(unsized, RTL)).toThrow(/unmodelled/);
    const reverse = <View style={{ flex: 1, flexDirection: 'row-reverse' }}><View testID="x" style={{ width: 10, height: 10 }} /></View>;
    expect(() => frames(reverse, LTR)).toThrow(/unmodelled style/);
  });

  it('layoutRules reads the device: isRTL and the swap setting', () => {
    expect(layoutRules({ isRTL: true, doLeftAndRightSwapInRTL: true })).toEqual(RTL);
    expect(layoutRules({ isRTL: true, doLeftAndRightSwapInRTL: false })).toEqual({ swap: false, rootDir: 'rtl' });
    expect(layoutRules({ isRTL: false, doLeftAndRightSwapInRTL: true })).toEqual(LTR);
  });
});
