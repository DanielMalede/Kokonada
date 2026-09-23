import { colors, emotionAnchors, type ThemeName } from '../tokens';
import { textScrimFill, glassFor } from '../auroraSurfaces';
import { auroraGlow } from '../emotionAccent';
import { hrGlowColor } from '../../experience/aura/auraBreath';
import { contrastRatio, parseHex, flatten, AA_NORMAL } from '../contrast';

// A palette pin, so it lives with the other contrast pins under src/design/__tests__ (the directory
// the design-system lint policy reserves for tests that specify colour values).
// The legal lines must hold WCAG AA (4.5:1, body text) on the worst frame of whatever is behind them.
// LegalNote paints content.secondary on textScrimFill (pinned in LegalNote.test.tsx); this file proves
// THAT pair over every backdrop the band can float over, in both faces, judged at full strength (no
// blob alpha, no blur, no veil) — strictly worse than anything that can render:
//   • Generate: the Living Aurora blobs, the frosted glass, the aura's focal glow for ANY emotion mean
//     (auroraGlow) and its heart-rate hue for ANY heart rate (hrGlowColor) — the halo overspills the
//     hero under the band — plus the canvas.
//   • Onboarding and Pulse: the flat canvas (surface.base).
// It is never on the Pulse emotion wash (PulseScreen.test.tsx pins it outside the StateCard).
// FAIL RULE (as auroraSurfaces.ts): densify the scrim or deepen the ink — never lower the threshold.

type Rgb = { r: number; g: number; b: number };
const toHex = ({ r, g, b }: Rgb) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const parseRgba = (s: string): { rgb: Rgb; a: number } => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(s);
  if (!m) throw new Error(`not an rgb()/rgba(): ${s}`);
  return { rgb: { r: +m[1], g: +m[2], b: +m[3] }, a: m[4] == null ? 1 : +m[4] };
};

// What the eye sees behind a legal glyph: the band's own fill, composited over the backdrop.
const underBand = (face: ThemeName, backdropHex: string) => {
  const { rgb, a } = parseRgba(textScrimFill(colors[face], face));
  return toHex(flatten(rgb, a, parseHex(backdropHex)));
};
const glassOver = (face: ThemeName, hex: string) => {
  const { rgb, a } = parseRgba(glassFor(colors[face], face).bg);
  return toHex(flatten(rgb, a, parseHex(hex)));
};

const GRID: number[] = [];
for (let v = -1; v <= 1.0001; v += 0.25) GRID.push(Math.round(v * 100) / 100);
const HEART_RATES: Array<number | null> = [null];
for (let hr = 30; hr <= 230; hr += 10) HEART_RATES.push(hr);

function backdrops(face: ThemeName): Array<[string, string]> {
  const c = colors[face];
  const out: Array<[string, string]> = [];
  for (const [k, blob] of Object.entries(c.aurora.blobs)) out.push([`aurora blob ${k}`, blob.color]);
  for (const x of GRID) for (const y of GRID) out.push([`auroraGlow(${x},${y})`, auroraGlow(x, y)]);
  for (const hr of HEART_RATES) out.push([`hrGlowColor(${hr})`, toHex(parseRgba(hrGlowColor(hr)).rgb)]);
  for (const [k, hex] of Object.entries(emotionAnchors)) out.push([`emotionAnchors.${k}`, hex]);
  out.push(['accent.glowIdle', c.accent.glowIdle]);
  out.push(['surface.base', c.surface.base]);
  out.push(['surface.canvasTop', c.surface.canvasTop]);
  out.push(['surface.canvasBottom', c.surface.canvasBottom]);
  return out;
}

describe.each(['light', 'dark'] as ThemeName[])('legal line contrast — %s face', (face) => {
  const ink = colors[face].content.secondary;

  it('content.secondary on the band clears AA over EVERY backdrop it can float over', () => {
    const fails = backdrops(face)
      .map(([what, hex]) => [what, contrastRatio(ink, underBand(face, hex))] as const)
      .filter(([, ratio]) => ratio < AA_NORMAL);
    expect(fails).toEqual([]);
  });

  it('…and still clears AA with the frosted glass composited over the scrim (designer pin)', () => {
    for (const blob of Object.values(colors[face].aurora.blobs)) {
      expect(contrastRatio(ink, glassOver(face, underBand(face, blob.color)))).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it('the sweep is real: it covers the full emotion plane and heart-rate range, not a handful of points', () => {
    expect(backdrops(face).length).toBeGreaterThanOrEqual(4 + 81 + 21);
  });

  it('NEGATIVE CONTROL: without the band the same sweep DOES find sub-AA backdrops (the scrim is load-bearing)', () => {
    const bare = backdrops(face).filter(([, hex]) => contrastRatio(ink, hex) < AA_NORMAL);
    expect(bare.length).toBeGreaterThan(0);
  });
});
