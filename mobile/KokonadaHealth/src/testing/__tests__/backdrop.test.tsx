import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { colors } from '../../design/tokens';
import { contrastRatio, flatten, parseHex, AA_NORMAL } from '../../design/contrast';
import { glassFor, textScrimFill } from '../../design/auroraSurfaces';
import { FACES } from '../faces';
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
// MB-167: these samples are v1 STAND-INS (the v1 aurora tokens and LivingAurora's 0.42 veil). When
// ADR-0017's v2 tokens land they are replaced by the V1 field's measured worst moments, in both faces.
// This jest helper never replaces the G11 on-device contrast measurement; it only stops a test from
// judging copy against a backdrop it never sits on.
const VEIL = 0.42;
const fieldSamples = (S: typeof C = C) => [S.surface.canvasTop, S.surface.canvasBottom].flatMap((canvas) =>
  [canvas, ...Object.values(S.aurora.blobs).map((b) => toHex(composite(parseColor(b.color), b.alpha, parseColor(canvas))))]
    .map((under) => toHex(composite(parseColor(S.surface.veilColor), VEIL, parseColor(under)))));
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

  it('the field reached through a chain with no layer at all also fails', () => {
    const node = textIn(<Text testID="copy" style={{ color: C.content.primary }}>Bare</Text>);
    expect(() => renderedContrast(node, OPTIONS())).toThrow(/reaches the field without a declared scrim/);
  });

  it.each([['a string', '0.5'], ['NaN', NaN], ['above 1', 1.5], ['below 0', -0.2], ['Infinity', Infinity]])(
    'RA-235-11: an opacity that is %s fails loudly instead of counting as 1', (_label, opacity) => {
      const node = textIn(
        <View style={{ backgroundColor: C.surface.base }}>
          <View style={{ opacity } as never}><Text testID="copy" style={{ color: C.content.primary }}>Hi</Text></View>
        </View>,
      );
      expect(() => renderedContrast(node, OPTIONS())).toThrow(/QA-119: .*opacity/);
    });

  it('RA-235-11: opacity at the bounds 0 and 1 is read as given', () => {
    for (const opacity of [0, 1]) {
      const node = textIn(
        <View style={{ backgroundColor: C.surface.base }}>
          <View style={{ opacity }}><Text testID="copy" style={{ color: C.content.primary }}>Hi</Text></View>
        </View>,
      );
      const text = opacity === 0 ? C.surface.base : C.content.primary;
      expect(renderedContrast(node, OPTIONS()).ratio).toBeCloseTo(contrastRatio(text, C.surface.base), 6);
    }
  });

  it('text with no colour of its own or from a parent Text fails loudly', () => {
    const node = textIn(<View style={{ backgroundColor: C.surface.base }}><Text testID="copy">x</Text></View>);
    expect(() => renderedContrast(node, OPTIONS())).toThrow(/no colour/);
  });
});

const h = React.createElement;

describe('RA-235-1 · QA-119: a field drawn as an earlier sibling under an opaque ancestor is not an opaque backdrop', () => {
  const SIB = { field: [C.surface.canvasTop, '#FF00FF'], scrims: [] as string[] };
  // GenerateScreen.tsx:242-245: an opaque surface.base root, LivingAurora as an absolute-fill first child,
  // the copy in a later sibling. The field paints over the root's colour and under the copy.
  const page = (withField: boolean, bar: React.ReactElement | null = null) => h(View, { style: { flex: 1, backgroundColor: C.surface.base } },
    withField ? h(View, { style: StyleSheet.absoluteFill }, h(View, { style: { flex: 1, backgroundColor: '#FF00FF' } })) : null,
    bar ?? h(View, { style: { backgroundColor: C.aurora.glass.night.bg } },
      h(Text, { testID: 'copy', style: { color: C.content.primary } }, 'Tab')));

  it('control: with nothing drawn under the text, the opaque root is the backdrop', () => {
    const r = renderedContrast(textIn(page(false)), SIB);
    expect(r.throughField).toBe(false);
    const g = parseColor(C.aurora.glass.night.bg);
    expect(r.backdrop).toBe(toHex(composite(g, g.a, parseColor(C.surface.base))));
  });

  it('GenerateScreen.tsx:242-245 shape: an absolute-fill sibling drawn before the text fails closed without a declared scrim', () => {
    expect(() => renderedContrast(textIn(page(true)), SIB)).toThrow(/QA-119: .*drawn beneath the text/);
  });

  it('the same layout with a declared scrim between the field and the text passes, judged against every field sample', () => {
    const scrimFill = textScrimFill(C, 'dark');
    const glass = C.aurora.glass.night.bg;
    const bar = h(View, { style: { backgroundColor: scrimFill } },
      h(View, { style: { backgroundColor: glass } }, h(Text, { testID: 'copy', style: { color: C.content.primary } }, 'Tab')));
    const r = renderedContrast(textIn(page(true, bar)), { ...SIB, scrims: [scrimFill] });
    expect(r.throughField).toBe(true);
    const s = parseColor(scrimFill);
    const g = parseColor(glass);
    const each = SIB.field.map((f) => contrastRatio(C.content.primary, toHex(composite(g, g.a, composite(s, s.a, parseColor(f))))));
    expect(each[0]).not.toBeCloseTo(each[1], 2); // the two samples differ, so the worst is a real choice
    expect(r.ratio).toBeCloseTo(Math.min(...each), 2);
  });

  it('a field sibling inside a composite wrapper is found too', () => {
    const Field = () => h(View, { style: StyleSheet.absoluteFill }, h(View, { style: { flex: 1, backgroundColor: '#FF00FF' } }));
    const el = h(View, { style: { flex: 1, backgroundColor: C.surface.base } }, h(Field),
      h(View, { style: { backgroundColor: C.aurora.glass.night.bg } }, h(Text, { testID: 'copy', style: { color: C.content.primary } }, 'Tab')));
    expect(() => renderedContrast(textIn(el), SIB)).toThrow(/drawn beneath the text/);
  });

  it('an opaque card between the field and the text still covers it exactly', () => {
    const bar = h(View, { style: { backgroundColor: C.surface.overlay } }, h(Text, { testID: 'copy', style: { color: C.content.primary } }, 'Card'));
    const r = renderedContrast(textIn(page(true, bar)), SIB);
    expect(r.throughField).toBe(false);
    expect(r.ratio).toBeCloseTo(contrastRatio(C.content.primary, C.surface.overlay), 6);
  });

  it('inline text before the copy inside the same Text is not drawn beneath it', () => {
    const el = h(View, { style: { backgroundColor: C.surface.base } },
      h(Text, { style: { color: C.content.primary } }, 'Lead ', h(Text, { testID: 'copy' }, 'span')));
    const r = renderedContrast(textIn(el), SIB);
    expect(r.throughField).toBe(false);
    expect(r.ratio).toBeCloseTo(contrastRatio(C.content.primary, C.surface.base), 6);
  });
});

// MB-166: the field cases run in BOTH faces, each with its own canvas, veil, glass and scrim.
describe.each(FACES)('QA-119 · the field, %s face', (face) => {
  const S = colors[face];
  const field = fieldSamples(S);
  const scrimFill = textScrimFill(S, face);
  const glass = glassFor(S, face).bg; // Day glass on light, Nocturne glass on dark
  const opts = { field, scrims: [scrimFill] };
  const expectedWorst = (layers: string[]) => Math.min(...field.map((f) => contrastRatio(S.content.primary,
    toHex(layers.reduce((under, l) => { const c = parseColor(l); return composite(c, c.a, under); }, parseColor(f))))));

  it("the face samples are this face's own field", () => {
    expect(field).toContain(toHex(composite(parseColor(S.surface.veilColor), VEIL, parseColor(S.surface.canvasTop))));
    expect(new Set(field).size).toBeGreaterThan(1);
  });

  it(`planted: a ${face === 'light' ? 'light-ground Day' : 'Nocturne'} glass bar over the field, with no declared scrim, fails`, () => {
    const node = textIn(<View style={{ backgroundColor: glass }}><Text testID="copy" style={{ color: S.content.primary }}>Tab</Text></View>);
    expect(() => renderedContrast(node, opts)).toThrow(/reaches the field without a declared scrim/);
  });

  it('planted: the same glass bar over a field drawn as an earlier sibling under an opaque root fails', () => {
    const node = textIn(
      <View style={{ flex: 1, backgroundColor: S.surface.base }}>
        <View style={StyleSheet.absoluteFill}><View style={{ flex: 1, backgroundColor: S.surface.canvasTop }} /></View>
        <View style={{ backgroundColor: glass }}><Text testID="copy" style={{ color: S.content.primary }}>Tab</Text></View>
      </View>,
    );
    expect(() => renderedContrast(node, opts)).toThrow(/QA-119: .*drawn beneath the text/);
  });

  it('a declared scrim over the field: judged against every field sample, the worst reported', () => {
    const node = textIn(<View style={{ backgroundColor: scrimFill }}><Text testID="copy" style={{ color: S.content.primary }}>Copy</Text></View>);
    const r = renderedContrast(node, opts);
    expect(r.throughField).toBe(true);
    expect(r.ratio).toBeCloseTo(expectedWorst([scrimFill]), 2);
    expect(r.ratio).toBeGreaterThanOrEqual(AA_NORMAL); // the densified scrim floor holds (auroraSurfaces.ts)
  });

  it('a declared scrim under glass, over a sibling field under an opaque root: every sample judged', () => {
    const node = textIn(
      <View style={{ flex: 1, backgroundColor: S.surface.base }}>
        <View style={StyleSheet.absoluteFill}><View style={{ flex: 1, backgroundColor: S.surface.canvasTop }} /></View>
        <View style={{ backgroundColor: scrimFill }}>
          <View style={{ backgroundColor: glass }}><Text testID="copy" style={{ color: S.content.primary }}>Tab</Text></View>
        </View>
      </View>,
    );
    const r = renderedContrast(node, opts);
    expect(r.throughField).toBe(true);
    expect(r.ratio).toBeCloseTo(expectedWorst([scrimFill, glass]), 2);
    expect(r.ratio).toBeGreaterThanOrEqual(AA_NORMAL);
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
