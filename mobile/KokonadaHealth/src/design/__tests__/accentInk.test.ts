import { accentInkFor } from '../accentInk';
import { emotionAccentFor } from '../emotionAccent';
import { colors } from '../tokens';
import type { Tap } from '../../state/cold/emotionSlice';

// accentInkFor is the presentational accent layer at the composition boundary (Fork 2A): it
// maps the committed taps to the active theme's emotionAccent INK, reusing emotionAccentFor for
// the quadrant. Pure, read-only, never throws — the reactive workhorse for dots / CTA / tinted
// text. It feeds ONLY presentation; it never touches deriveAuraUniforms.

const tap = (x: number, y: number): Tap => ({ x, y });

describe('accentInkFor — theme-resolved emotion ink', () => {
  it('empty / absent taps → the brand calm ink (both themes)', () => {
    expect(accentInkFor([], colors.dark)).toBe(colors.dark.emotionAccent.calm.ink);
    expect(accentInkFor([], colors.light)).toBe(colors.light.emotionAccent.calm.ink);
    expect(accentInkFor(undefined, colors.dark)).toBe(colors.dark.emotionAccent.calm.ink);
    expect(accentInkFor(null as any, colors.light)).toBe(colors.light.emotionAccent.calm.ink);
  });

  it('the quadrant it resolves matches emotionAccentFor for the same taps', () => {
    const cases: Tap[][] = [
      [tap(0.6, -0.6)],           // calm
      [tap(0.6, 0.6)],            // joyful
      [tap(-0.6, 0.6)],           // intense
      [tap(-0.6, -0.6)],          // reflective
      [tap(-0.8, 0.2), tap(-0.6, 0.8)], // mean → intense
    ];
    for (const taps of cases) {
      const q = emotionAccentFor(taps);
      expect(accentInkFor(taps, colors.dark)).toBe(colors.dark.emotionAccent[q].ink);
      expect(accentInkFor(taps, colors.light)).toBe(colors.light.emotionAccent[q].ink);
    }
  });

  it('returns the correct LIGHT vs DARK hex from tokens for the same quadrant', () => {
    const joy = [tap(0.6, 0.6)];
    expect(accentInkFor(joy, colors.dark)).toBe('#FFD37A');  // dark joyful ink (Aurora gold)
    expect(accentInkFor(joy, colors.light)).toBe('#8A5A12'); // light joyful ink (deep gold)
    const intense = [tap(-0.6, 0.6)];
    expect(accentInkFor(intense, colors.dark)).toBe('#C4A6FF');  // dark violet (never red)
    expect(accentInkFor(intense, colors.light)).toBe('#6E3FC4'); // light violet
  });

  it('never throws on malformed input — degrades to calm ink', () => {
    expect(() => accentInkFor('nope' as any, colors.dark)).not.toThrow();
    expect(accentInkFor([{ x: NaN, y: 1 } as any], colors.dark)).toBe(colors.dark.emotionAccent.calm.ink);
  });
});
