import React from 'react';
import { Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { colors } from '../../design/tokens';
import { contrastRatio, flatten, parseHex, AA_NORMAL } from '../../design/contrast';
import { textScrimFill } from '../../design/auroraSurfaces';
import { composite, parseColor, renderedContrast, toHex } from '../backdrop';

// QA-119: a jest contrast assertion computes its backdrop from the RENDERED ancestor chain,
// compositing translucent layers; reaching the field without a declared scrim fails. Today's
// assertions assume a backdrop (EmotionTabBar.test.tsx:118-129 judges against surface.base;
// tokens.test.ts:86-91 judges glass over base only), so a translucent bar over the living field
// passes a check that measured something it never sits on.
// Pass rule: every v2 contrast assertion goes through the helper (adoption owed); a planted glass bar
// over the field fails.

const C = colors.dark;
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(() => { for (const t of mounted.splice(0)) act(() => { t.unmount(); }); });
const textIn = (el: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => { tree = ReactTestRenderer.create(el); });
  mounted.push(tree);
  return tree.root.findAll((n) => String(n.type) === 'Text' && n.props.testID === 'copy')[0];
};

// The v1 field's worst moments, built from the tokens: each aurora blob at its own alpha over each end
// of the canvas gradient, under LivingAurora's 0.42 veil (LivingAurora.tsx:21).
const VEIL = 0.42;
const fieldSamples = () => [C.surface.canvasTop, C.surface.canvasBottom].flatMap((canvas) =>
  [canvas, ...Object.values(C.aurora.blobs).map((b) => toHex(composite(parseColor(b.color), b.alpha, parseColor(canvas))))]
    .map((under) => toHex(composite(parseColor(C.surface.veilColor), VEIL, parseColor(under)))));
const OPTIONS = () => ({ field: fieldSamples(), scrims: [textScrimFill(C, 'dark')] });

describe('QA-119 · the backdrop is the rendered chain', () => {
  it('an opaque surface: the ratio is exactly the token pair', () => {
    const node = textIn(<View style={{ backgroundColor: C.surface.base }}><Text testID="copy" style={{ color: C.content.primary }}>Hi</Text></View>);
    const r = renderedContrast(node, OPTIONS());
    expect(r.throughField).toBe(false);
    expect(r.ratio).toBeCloseTo(contrastRatio(C.content.primary, C.surface.base), 6);
  });

  it('glass over an opaque surface: the glass is composited onto what it actually covers', () => {
    const glass = C.aurora.glass.night.bg;
    const node = textIn(
      <View style={{ backgroundColor: C.surface.overlay }}>
        <View style={{ backgroundColor: glass }}><Text testID="copy" style={{ color: C.content.primary }}>Hi</Text></View>
      </View>,
    );
    const g = parseColor(glass);
    const under = flatten(g, g.a, parseHex(C.surface.overlay));
    const expected = contrastRatio(C.content.primary, toHex(under));
    expect(renderedContrast(node, OPTIONS()).ratio).toBeCloseTo(expected, 2);
  });

  it('group opacity fades the text and its backdrop together over what lies beneath', () => {
    const node = textIn(
      <View style={{ backgroundColor: C.surface.base }}>
        <View style={{ opacity: 0.5 }}><Text testID="copy" style={{ color: C.content.primary }}>Hi</Text></View>
      </View>,
    );
    const faded = toHex(composite(parseColor(C.content.primary), 0.5, parseColor(C.surface.base)));
    expect(renderedContrast(node, OPTIONS()).ratio).toBeCloseTo(contrastRatio(faded, C.surface.base), 2);
  });

  it('planted: a glass bar over the field, with no declared scrim, fails', () => {
    const node = textIn(
      <View style={{ backgroundColor: C.aurora.glass.night.bg }}><Text testID="copy" style={{ color: C.content.primary }}>Tab</Text></View>,
    );
    expect(() => renderedContrast(node, OPTIONS())).toThrow(/reaches the field without a declared scrim/);
  });

  it('a declared scrim over the field: judged against every field sample, the worst reported', () => {
    const node = textIn(
      <View style={{ backgroundColor: textScrimFill(C, 'dark') }}><Text testID="copy" style={{ color: C.content.primary }}>Copy</Text></View>,
    );
    const r = renderedContrast(node, OPTIONS());
    expect(r.throughField).toBe(true);
    const scrim = parseColor(textScrimFill(C, 'dark'));
    const each = fieldSamples().map((s) => contrastRatio(C.content.primary, toHex(composite(scrim, scrim.a, parseColor(s)))));
    expect(r.ratio).toBeCloseTo(Math.min(...each), 2);
    expect(r.ratio).toBeGreaterThanOrEqual(AA_NORMAL); // the densified scrim floor holds (auroraSurfaces.ts)
  });

  it('the field reached through a chain with no layer at all also fails', () => {
    const node = textIn(<Text testID="copy" style={{ color: C.content.primary }}>Bare</Text>);
    expect(() => renderedContrast(node, OPTIONS())).toThrow(/reaches the field without a declared scrim/);
  });

  it('text with no colour of its own or from a parent Text fails loudly', () => {
    const node = textIn(<View style={{ backgroundColor: C.surface.base }}><Text testID="copy">x</Text></View>);
    expect(() => renderedContrast(node, OPTIONS())).toThrow(/no colour/);
  });
});

describe('QA-119 · colour parsing', () => {
  it('reads #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(), and transparent', () => {
    expect(parseColor(C.surface.scrim)).toMatchObject({ r: 0, g: 0, b: 0 }); // '#00000073'
    expect(parseColor(C.surface.scrim).a).toBeCloseTo(0x73 / 255, 6);
    expect(parseColor(C.aurora.glass.night.bg)).toEqual({ r: 255, g: 255, b: 255, a: 0.1 });
    expect(parseColor('transparent').a).toBe(0);
    expect(toHex(parseColor(C.content.primary))).toBe(C.content.primary.toUpperCase());
  });

  it('refuses a colour it cannot read (a named colour, a typo) instead of guessing', () => {
    expect(() => parseColor('rebeccapurple')).toThrow(/cannot read/);
    expect(() => parseColor('#12')).toThrow(/cannot read/);
  });
});
