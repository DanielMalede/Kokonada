import {
  TEXT_SCRIM_FLOOR,
  textScrimFill,
  glassFor,
  auroraCtaStops,
  onAuroraInk,
  sampleGradient,
  CTA_MID_STOP,
  CTA_LABEL_BAND,
  CTA_INK,
  DEEP_INTENSE,
} from '../auroraSurfaces';
import { colors, type ThemeName } from '../tokens';
import { auroraGlow } from '../emotionAccent';
import { contrastRatio, parseHex, flatten, relativeLuminance, AA_NORMAL, AA_LARGE } from '../contrast';

// AURORA's legibility contract. The aurora is a LIVE, MOVING gradient: a token that clears AA on a
// flat surface can be illegible the moment a gold blob drifts under it. So the guard here is not
// "ink vs surface.base" — it is "ink vs what is ACTUALLY behind the glyph while the field moves":
// the worst-case blob, with the text scrim (and the glass it wears) composited on top.
//
// FAIL CONDITION (the frame's #1 guard): if any pairing below drops under AA, the fix is to DARKEN
// or DENSIFY the scrim — never to lower the threshold and never to swap in a lighter ink.

const toHex = ({ r, g, b }: { r: number; g: number; b: number }) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;

// What the eye sees under a glyph: blob → text scrim at its FLOOR alpha. The blob is judged at full
// strength (no blob alpha, no veil, no blur) — strictly worse than anything that can render.
const scrimOverBlob = (name: ThemeName, blobHex: string) => {
  const c = colors[name];
  return toHex(flatten(parseHex(c.surface.textScrim.base), TEXT_SCRIM_FLOOR[name], parseHex(blobHex)));
};
// …and the same again with the frosted glass a text cluster wears ON TOP of its scrim.
const glassOverScrim = (name: ThemeName, blobHex: string) => {
  const g = glassFor(colors[name], name);
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(g.bg);
  if (!m) throw new Error(`glass bg is not an rgba(): ${g.bg}`);
  const [, r, gg, b, a] = m;
  return toHex(flatten({ r: +r, g: +gg, b: +b }, +a, parseHex(scrimOverBlob(name, blobHex))));
};

const BLOBS = (name: ThemeName) => Object.values(colors[name].aurora.blobs).map((b) => b.color);

describe('AA-OVER-AURORA — copy stays legible over the worst-case moving blob (the frame’s #1 guard)', () => {
  it('NOCTURNE: primary AND muted clear AA over the LIGHTEST blobs (gold, pink) + scrim', () => {
    const c = colors.dark;
    for (const blob of [c.aurora.blobs.gold.color, c.aurora.blobs.pink.color]) {
      const backdrop = scrimOverBlob('dark', blob);
      expect(contrastRatio(c.content.primary, backdrop)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(contrastRatio(c.content.muted, backdrop)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('NOCTURNE: …and over EVERY blob, not only the two lightest', () => {
    const c = colors.dark;
    for (const blob of BLOBS('dark')) {
      const backdrop = scrimOverBlob('dark', blob);
      expect(contrastRatio(c.content.primary, backdrop)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(contrastRatio(c.content.muted, backdrop)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('DAY: primary AND muted clear AA over every blob + scrim (the darkest, violet, is the threat)', () => {
    const c = colors.light;
    for (const blob of BLOBS('light')) {
      const backdrop = scrimOverBlob('light', blob);
      expect(contrastRatio(c.content.primary, backdrop)).toBeGreaterThanOrEqual(AA_NORMAL);
      expect(contrastRatio(c.content.muted, backdrop)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('holds with the FROSTED GLASS composited on top of the scrim (what a text cluster really wears)', () => {
    for (const name of ['dark', 'light'] as ThemeName[]) {
      const c = colors[name];
      for (const blob of BLOBS(name)) {
        const backdrop = glassOverScrim(name, blob);
        expect(contrastRatio(c.content.primary, backdrop)).toBeGreaterThanOrEqual(AA_NORMAL);
        expect(contrastRatio(c.content.muted, backdrop)).toBeGreaterThanOrEqual(AA_NORMAL);
      }
    }
  });

  it('the scrim FILL is the token scrim hue at the floor alpha (hue stays token-sourced)', () => {
    for (const name of ['dark', 'light'] as ThemeName[]) {
      const { r, g, b } = parseHex(colors[name].surface.textScrim.base);
      expect(textScrimFill(colors[name], name)).toBe(`rgba(${r},${g},${b},${TEXT_SCRIM_FLOOR[name]})`);
    }
  });

  it('the DENSIFICATION is load-bearing: the token ramp’s own `to` alpha is NOT enough for muted', () => {
    // Documents WHY the floor exists. The ramp (0 → .55) is tuned for display copy over a hero;
    // supporting copy over a gold blob fails at .55, so the cluster backstop is densified until it
    // passes. If a future edit relaxes the floor back to the ramp, this pin fails loudly.
    const c = colors.dark;
    const atRampTo = toHex(flatten(parseHex(c.surface.textScrim.base), c.surface.textScrim.to, parseHex(c.aurora.blobs.gold.color)));
    expect(contrastRatio(c.content.muted, atRampTo)).toBeLessThan(AA_NORMAL); // the failure we fixed
    expect(TEXT_SCRIM_FLOOR.dark).toBeGreaterThan(c.surface.textScrim.to);
    expect(TEXT_SCRIM_FLOOR.light).toBeGreaterThan(colors.light.surface.textScrim.to);
    for (const a of Object.values(TEXT_SCRIM_FLOOR)) expect(a).toBeLessThanOrEqual(1);
  });

  it('glassFor hands the DAY glass to the light face and the NIGHT glass to Nocturne', () => {
    expect(glassFor(colors.light, 'light')).toBe(colors.light.aurora.glass.day);
    expect(glassFor(colors.dark, 'dark')).toBe(colors.dark.aurora.glass.night);
  });
});

describe('auroraCtaStops — the morphing CTA gradient (sky → your emotion → gold)', () => {
  it('runs calm sky → the emotion glow at 55% → premium gold', () => {
    const stops = auroraCtaStops(0.6, -0.6);
    expect(stops[0]).toBe('#3FB4F0');                 // calm sky, always the left anchor
    expect(stops[2]).toBe('#F5B93A');                 // gold, always the right anchor
    expect(stops[1]).toBe(auroraGlow(0.6, -0.6));     // the mid IS the user's continuous glow
    expect(CTA_MID_STOP).toBeCloseTo(0.55, 10);
  });

  it('DEEPENS the mid stop at the intense pole (bright violet is too light to carry a label)', () => {
    expect(auroraCtaStops(-1, 1)[1]).toBe(DEEP_INTENSE);
    expect(DEEP_INTENSE).toBe(colors.light.accent.glowInk); // #6E3FC4 — token-sourced, not a raw hex
    // …and the deepening is CONTINUOUS: at the origin it is negligible, so the CTA never jumps.
    const mid = auroraCtaStops(0, 0)[1];
    const raw = parseHex(auroraGlow(0, 0));
    const got = parseHex(mid);
    for (const k of ['r', 'g', 'b'] as const) expect(Math.abs(got[k] - raw[k])).toBeLessThanOrEqual(8);
  });

  it('the deepening only ever DARKENS, and only toward the intense corner', () => {
    expect(relativeLuminance(auroraCtaStops(-1, 1)[1])).toBeLessThan(relativeLuminance(auroraGlow(-1, 1)));
    for (const [x, y] of [[1, 1], [1, -1], [-1, -1]] as Array<[number, number]>) {
      expect(auroraCtaStops(x, y)[1]).toBe(auroraGlow(x, y)); // the other three poles are untouched
    }
  });

  it('never emits a malformed stop, even from a hostile mean (it feeds a Skia gradient)', () => {
    for (const [x, y] of [[NaN, 0], [0, Infinity], [undefined as any, null as any], [99, -99]]) {
      const stops = auroraCtaStops(x as number, y as number);
      expect(stops).toHaveLength(3);
      for (const s of stops) expect(s).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe('onAuroraInk — the ADAPTIVE label ink survives the whole gradient, not just its midpoint', () => {
  it('picks the dark indigo ink on the gold pole and white on the deepened intense pole', () => {
    expect(onAuroraInk(auroraCtaStops(1, 1))).toBe(CTA_INK.dark);   // gold → dark ink
    expect(onAuroraInk(auroraCtaStops(-1, 1))).toBe(CTA_INK.light); // deep violet → white
    expect(CTA_INK.dark).toBe(colors.light.content.primary);        // #241B45, token-sourced
    expect(CTA_INK.light).toBe(colors.light.content.onAccent);      // #FFFFFF
  });

  it('FUZZ: whatever the emotion, the chosen ink clears AA-LARGE across the label’s whole band', () => {
    // The label is centred but WIDE — its ends sit well outside the mid stop. Judging the ink on the
    // midpoint alone ships a button whose edges are illegible, so the band is what is pinned.
    let worst = Infinity;
    for (let x = -1; x <= 1.0001; x += 0.1) {
      for (let y = -1; y <= 1.0001; y += 0.1) {
        const stops = auroraCtaStops(x, y);
        const ink = onAuroraInk(stops);
        for (let t = CTA_LABEL_BAND[0]; t <= CTA_LABEL_BAND[1] + 1e-9; t += 0.02) {
          const ratio = contrastRatio(ink, sampleGradient(stops, t));
          worst = Math.min(worst, ratio);
          expect(ratio).toBeGreaterThanOrEqual(AA_LARGE);
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('the label band is a real, conservative span of the button (not a single point)', () => {
    expect(CTA_LABEL_BAND[0]).toBeLessThan(CTA_MID_STOP);
    expect(CTA_LABEL_BAND[1]).toBeGreaterThan(CTA_MID_STOP);
    expect(CTA_LABEL_BAND[1] - CTA_LABEL_BAND[0]).toBeGreaterThanOrEqual(0.4);
  });

  it('WHY not a fixed luminance threshold: the naive "≥.35 → dark, else white" rule ships a FAILURE', () => {
    // Counter-example that motivated the max-min rule. This mid is under .35, so the naive rule
    // picks WHITE — which is sub-AA-large on it. Our rule must pick the other ink here.
    const stops = auroraCtaStops(0.3, 0.4);
    const mid = stops[1];
    expect(relativeLuminance(mid)).toBeLessThan(0.35);                       // the naive rule says "white"
    expect(contrastRatio(CTA_INK.light, mid)).toBeLessThan(AA_LARGE);        // …and white FAILS on it
    expect(onAuroraInk(stops)).toBe(CTA_INK.dark);                           // we pick the ink that holds
    expect(contrastRatio(onAuroraInk(stops), mid)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it('sampleGradient walks the three stops in order and is total at the edges', () => {
    const stops = auroraCtaStops(1, -1);
    expect(sampleGradient(stops, 0)).toBe(stops[0]);
    expect(sampleGradient(stops, CTA_MID_STOP)).toBe(stops[1]);
    expect(sampleGradient(stops, 1)).toBe(stops[2]);
    for (const t of [-5, 5, NaN, Infinity]) expect(sampleGradient(stops, t)).toMatch(/^#[0-9A-F]{6}$/);
  });
});
