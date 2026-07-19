import { colors, type ColorScheme, type ThemeName, type EmotionQuadrant } from '../tokens';
import { contrastRatio, AA_NORMAL } from '../contrast';

// The discovery visual-direction token delta (spec 2026-07-13 §1.2/§1.3). `emotionAccent` is a
// valence×arousal quadrant matrix whose `ink` is used as text / icon / hairline on the three
// discovery surfaces (base / raised / overlay). The CONTRACT is that every `ink` clears WCAG 2.2
// AA-normal on all three, in BOTH themes — so a token edit that drops any ink below AA fails HERE,
// not on a user's screen. These pins lock the designer's hand-computed ratios against drift.
// `wash` is decorative (alpha baked into the hex) → no AA requirement, but its exact value is
// pinned so the tint can never silently change.

const themes: ThemeName[] = ['dark', 'light'];
const quadrants: EmotionQuadrant[] = ['calm', 'joyful', 'intense', 'reflective'];

describe.each(themes)('emotionAccent ink is AA-safe on the discovery surfaces — theme "%s"', (name) => {
  const c: ColorScheme = colors[name];
  const surfaces: Array<[string, string]> = [
    ['base', c.surface.base],
    ['raised', c.surface.raised],
    ['overlay', c.surface.overlay],
  ];
  describe.each(quadrants)('quadrant "%s"', (q) => {
    it.each(surfaces)('ink clears AA-normal on %s (≥ 4.5)', (_label, surf) => {
      expect(contrastRatio(c.emotionAccent[q].ink, surf)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  });
});

// Exact-value pins — the designer's authority hexes, ink + wash (with baked alpha), both themes.
// A drift in any literal fails here even if it still happens to clear AA.
describe('emotionAccent — designer authority hexes (exact)', () => {
  it('dark quadrant inks + washes', () => {
    expect(colors.dark.emotionAccent).toEqual({
      calm: { ink: '#F2C879', wash: '#F2C87924', onAccent: '#1C1408' },
      joyful: { ink: '#FFC24D', wash: '#FFC24D24', onAccent: '#1C1408' },
      intense: { ink: '#D9ADFF', wash: '#D9ADFF24', onAccent: '#1C1408' },
      reflective: { ink: '#B7A6FF', wash: '#B7A6FF24', onAccent: '#1C1408' },
    });
  });
  it('light quadrant inks + washes', () => {
    expect(colors.light.emotionAccent).toEqual({
      calm: { ink: '#7A5A10', wash: '#7A5A1014', onAccent: '#2A1B00' },
      joyful: { ink: '#8F5410', wash: '#8F541014', onAccent: '#2A1B00' },
      intense: { ink: '#6E3FC4', wash: '#6E3FC414', onAccent: '#FFFFFF' },
      reflective: { ink: '#573CB8', wash: '#573CB814', onAccent: '#FFFFFF' },
    });
  });
  it('calm dark ink IS the brand accent glow (a calm session wears the brand accent)', () => {
    expect(colors.dark.emotionAccent.calm.ink).toBe(colors.dark.accent.glow);
  });
});

// In DARK, discovery paints `ink` as a solid emotion chip and drops `onAccent` as the label ON
// that fill, so onAccent must clear AA-normal over its own quadrant ink. (Dark only — the light
// fills use onAccent as a fill-label whose legibility is governed by the light spec, not asserted
// here: light onAccent is white/near-black-brown on a mid-value ink and fails this by design.)
describe('emotionAccent onAccent is AA-safe as a label on its own ink — dark', () => {
  it.each(quadrants)('onAccent clears AA-normal on the %s ink fill (≥ 4.5)', (q) => {
    expect(contrastRatio(colors.dark.emotionAccent[q].onAccent, colors.dark.emotionAccent[q].ink)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('surface.scrim — sheet backdrop dim (decorative, no AA)', () => {
  it('carries the designer alpha values in both themes', () => {
    expect(colors.dark.surface.scrim).toBe('#00000073');
    expect(colors.light.surface.scrim).toBe('#12202B59');
  });
});
