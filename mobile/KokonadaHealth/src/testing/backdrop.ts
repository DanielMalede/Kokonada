// QA-119: contrast measured against the RENDERED backdrop.
//
// renderedContrast walks a rendered text node's host ancestors (react-test-renderer) from the root down
// and composites what RN would draw under the glyphs: each layer's background colour with its alpha,
// and each layer's opacity as group opacity (the layer and everything inside it fade together over what
// lies beneath). If the layers cover opaquely, the backdrop is one exact colour. If the result still
// depends on what lies beneath the root, the text reaches the living field: that requires a declared
// scrim on the chain, and the text is then judged against every field sample the caller supplies, the
// worst case reported. Reaching the field with no declared scrim throws. A layer the walk cannot model
// (an image) and a text with no colour throw too: the helper fails closed, never guesses.
// Siblings drawn behind the text (an absolutely positioned card) are not on the ancestor chain: the
// walk then reports the field, which fails closed and asks for the scrim to be declared.

import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { contrastRatio } from '../design/contrast';

export interface Rgba { r: number; g: number; b: number; a: number }

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FN = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/** #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba() and 'transparent'. Anything else throws. */
export function parseColor(input: string): Rgba {
  const s = String(input).trim();
  if (s.toLowerCase() === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const hex = HEX.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = FN.exec(s);
  if (fn) return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) };
  throw new Error(`QA-119: cannot read the colour ${JSON.stringify(input)}`);
}

/** `fg` at `alpha` over an opaque `bg` (alpha compositing in sRGB, as RN draws). */
export function composite(fg: { r: number; g: number; b: number }, alpha: number, bg: { r: number; g: number; b: number }): Rgba {
  const a = Math.max(0, Math.min(1, alpha));
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

export function toHex(c: { r: number; g: number; b: number }): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).toUpperCase().padStart(2, '0');
  return '#' + [h(c.r), h(c.g), h(c.b)].join('');
}

export interface BackdropOptions {
  /** Opaque colours the field can show under the text at its worst moments. */
  field: string[];
  /** The scrim fills a page declares (laid between the field and copy). */
  scrims: string[];
}
export interface ContrastReading { ratio: number; text: string; backdrop: string; throughField: boolean }

type Layer = { bg: Rgba; opacity: number; type: string };
const over = (c: Rgba, beneath: Rgba): Rgba => composite(c, c.a, beneath);
const lerp = (from: Rgba, to: Rgba, t: number): Rgba => composite(to, t, from);

export function renderedContrast(node: ReactTestInstance, options: BackdropOptions): ContrastReading {
  const chain: ReactTestInstance[] = [];
  for (let n: ReactTestInstance | null = node; n; n = n.parent) if (typeof n.type === 'string') chain.unshift(n);
  const style = (n: ReactTestInstance) => (StyleSheet.flatten(n.props.style) ?? {}) as Record<string, unknown>;

  const hostType = (n: ReactTestInstance) => String(n.type);
  const textColour = [...chain].reverse().find((n) => hostType(n) === 'Text' && style(n).color != null);
  if (!textColour) throw new Error('QA-119: the text has no colour of its own or from a parent Text.');
  const fg = parseColor(String(style(textColour).color));

  const layers: Layer[] = chain.map((n) => {
    if (hostType(n) === 'Image') throw new Error('QA-119: an image on the backdrop chain cannot be composited; declare a scrim above it.');
    const s = style(n);
    return {
      type: hostType(n),
      bg: s.backgroundColor != null ? parseColor(String(s.backgroundColor)) : { r: 0, g: 0, b: 0, a: 0 },
      opacity: typeof s.opacity === 'number' ? s.opacity : 1,
    };
  });

  // F(i, beneath): group i drawn over `beneath`: its background, then everything inside it, at its opacity.
  const draw = (beneath: Rgba, withText: boolean): Rgba => {
    const group = (i: number, under: Rgba): Rgba => {
      if (i === layers.length) return withText ? over(fg, under) : under;
      const inner = group(i + 1, over(layers[i].bg, under));
      return lerp(under, inner, layers[i].opacity);
    };
    return group(0, beneath);
  };

  const black = { r: 0, g: 0, b: 0, a: 1 };
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const onBlack = draw(black, false);
  const onWhite = draw(white, false);
  const opaque = Math.abs(onBlack.r - onWhite.r) + Math.abs(onBlack.g - onWhite.g) + Math.abs(onBlack.b - onWhite.b) < 0.5;
  if (opaque) {
    const backdrop = toHex(onBlack);
    const text = toHex(draw(black, true));
    return { ratio: contrastRatio(text, backdrop), text, backdrop, throughField: false };
  }

  const declared = new Set(options.scrims.map((s) => toHex(parseColor(s)) + parseColor(s).a.toFixed(4)));
  const hasScrim = layers.some((l) => l.bg.a > 0 && declared.has(toHex(l.bg) + l.bg.a.toFixed(4)));
  if (!hasScrim) {
    const seen = layers.filter((l) => l.bg.a > 0).map((l) => `${l.type} ${toHex(l.bg)}@${l.bg.a}`).join(' > ') || 'no layer';
    throw new Error(`QA-119: the text reaches the field without a declared scrim (chain: ${seen}).`);
  }
  if (options.field.length === 0) throw new Error('QA-119: the text reaches the field, and no field samples were given.');
  let worst: ContrastReading | null = null;
  for (const sample of options.field) {
    const base = { ...parseColor(sample), a: 1 };
    const backdrop = toHex(draw(base, false));
    const text = toHex(draw(base, true));
    const ratio = contrastRatio(text, backdrop);
    if (!worst || ratio < worst.ratio) worst = { ratio, text, backdrop, throughField: true };
  }
  return worst!;
}
