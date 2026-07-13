import { emotionAccentFor } from '../emotionAccent';
import type { Tap } from '../../state/cold/emotionSlice';

// emotionAccentFor maps the committed emotionSlice taps (x = valence, y = arousal, each −1..1) to a
// discovery accent quadrant. Pure, presentational, read-only — it never throws and is static for
// the session. Quadrant is chosen by the SIGN of the MEAN tap, with a ‖·‖ < 0.15 origin deadzone →
// calm, and an empty / absent tap set → calm (the brand-accent default).

const tap = (x: number, y: number): Tap => ({ x, y });

describe('emotionAccentFor — quadrant by mean-tap sign', () => {
  it('positive valence, negative arousal → calm', () => {
    expect(emotionAccentFor([tap(0.6, -0.6)])).toBe('calm');
  });
  it('positive valence, positive arousal → joyful', () => {
    expect(emotionAccentFor([tap(0.6, 0.6)])).toBe('joyful');
  });
  it('negative valence, positive arousal → intense', () => {
    expect(emotionAccentFor([tap(-0.6, 0.6)])).toBe('intense');
  });
  it('negative valence, negative arousal → reflective', () => {
    expect(emotionAccentFor([tap(-0.6, -0.6)])).toBe('reflective');
  });
  it('on the valence axis (x = 0): y≥0 → joyful, y<0 → calm', () => {
    expect(emotionAccentFor([tap(0, 0.6)])).toBe('joyful');
    expect(emotionAccentFor([tap(0, -0.6)])).toBe('calm');
  });
});

describe('emotionAccentFor — deadzone & empty → calm', () => {
  it('a mean within the ‖·‖ < 0.15 origin deadzone → calm', () => {
    expect(emotionAccentFor([tap(0.1, -0.05)])).toBe('calm'); // |mean| ≈ 0.112 < 0.15
    // sign would place this in `intense`, but the magnitude is inside the deadzone → calm
    expect(emotionAccentFor([tap(-0.1, 0.05)])).toBe('calm');
  });
  it('empty tap list → calm', () => {
    expect(emotionAccentFor([])).toBe('calm');
  });
  it('no taps (undefined) → calm', () => {
    expect(emotionAccentFor(undefined as any)).toBe('calm');
  });
});

describe('emotionAccentFor — mean of multiple taps lands in the right quadrant', () => {
  it('two taps averaging into intense', () => {
    // (−0.8, 0.2) & (−0.6, 0.8) → mean (−0.7, 0.5) → x<0, y≥0 → intense
    expect(emotionAccentFor([tap(-0.8, 0.2), tap(-0.6, 0.8)])).toBe('intense');
  });
  it('taps straddling the x-origin whose MEAN clears the deadzone into reflective', () => {
    // (0.2, −0.6) & (−0.8, −0.4) → mean (−0.3, −0.5) → x<0, y<0 → reflective
    expect(emotionAccentFor([tap(0.2, -0.6), tap(-0.8, -0.4)])).toBe('reflective');
  });
});

describe('emotionAccentFor — pure & defensive (malformed input never throws → calm)', () => {
  it('null → calm', () => {
    expect(emotionAccentFor(null as any)).toBe('calm');
  });
  it('a non-array value → calm', () => {
    expect(emotionAccentFor({} as any)).toBe('calm');
    expect(emotionAccentFor('nope' as any)).toBe('calm');
  });
  it('taps with non-finite / non-number coords are ignored (→ calm when none valid)', () => {
    expect(emotionAccentFor([{ x: NaN, y: 1 } as any, { x: 'a', y: 'b' } as any])).toBe('calm');
  });
});
