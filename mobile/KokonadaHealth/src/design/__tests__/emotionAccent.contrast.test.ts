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
      calm: { ink: '#31E1C4', wash: '#31E1C424' },
      joyful: { ink: '#FFC06B', wash: '#FFC06B24' },
      intense: { ink: '#C4A6FF', wash: '#C4A6FF24' },
      reflective: { ink: '#9DB4FF', wash: '#9DB4FF24' },
    });
  });
  it('light quadrant inks + washes', () => {
    expect(colors.light.emotionAccent).toEqual({
      calm: { ink: '#0A7A6B', wash: '#0A7A6B14' },
      joyful: { ink: '#A34E24', wash: '#A34E2414' },
      intense: { ink: '#6E3FC4', wash: '#6E3FC414' },
      reflective: { ink: '#3A5CCC', wash: '#3A5CCC14' },
    });
  });
  it('calm dark ink IS the brand accent glow (a calm session wears the brand accent)', () => {
    expect(colors.dark.emotionAccent.calm.ink).toBe(colors.dark.accent.glow);
  });
});

describe('surface.scrim — sheet backdrop dim (decorative, no AA)', () => {
  it('carries the designer alpha values in both themes', () => {
    expect(colors.dark.surface.scrim).toBe('#00000073');
    expect(colors.light.surface.scrim).toBe('#12202B59');
  });
});
