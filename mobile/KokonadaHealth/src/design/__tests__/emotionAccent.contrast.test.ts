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
      calm: { ink: '#7FCDF5', wash: '#3FB4F024' },
      joyful: { ink: '#FFD37A', wash: '#F5B93A24' },
      intense: { ink: '#C4A6FF', wash: '#8B6FE824' },
      reflective: { ink: '#9DB4FF', wash: '#4B6FD024' },
    });
  });
  it('light quadrant inks + washes', () => {
    expect(colors.light.emotionAccent).toEqual({
      calm: { ink: '#1F6FA6', wash: '#3FB4F014' },
      joyful: { ink: '#8A5A12', wash: '#F5B93A14' },
      intense: { ink: '#6E3FC4', wash: '#8B6FE814' },
      reflective: { ink: '#3A5CCC', wash: '#4B6FD014' },
    });
  });
  // AURORA decouples the two: the ambient BRAND is the violet focal glow, while CALM is the sky
  // stop of the aurora gradient. (Pre-Aurora these were one cyan literal.) Pin both so neither
  // silently drifts back into the other.
  it('calm dark ink is the Aurora SKY, distinct from the violet brand glow (which equals glowIdle)', () => {
    expect(colors.dark.emotionAccent.calm.ink).toBe('#7FCDF5');
    expect(colors.dark.accent.glow).toBe('#9B7BF0');
    expect(colors.dark.emotionAccent.calm.ink).not.toBe(colors.dark.accent.glow);
    expect(colors.dark.accent.glow).toBe(colors.dark.accent.glowIdle);
    expect(colors.light.accent.glow).toBe(colors.light.accent.glowIdle);
  });
});

describe('surface.scrim — sheet backdrop dim (decorative, no AA)', () => {
  it('carries the designer alpha values in both themes', () => {
    expect(colors.dark.surface.scrim).toBe('#00000073');
    expect(colors.light.surface.scrim).toBe('#12202B59');
  });
});
