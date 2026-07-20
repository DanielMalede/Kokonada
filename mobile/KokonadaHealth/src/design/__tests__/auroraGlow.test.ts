import { auroraGlow, AURORA_CORNERS } from '../emotionAccent';
import { emotionAnchors, colors } from '../tokens';

// AURORA's reactive emotion→colour. `emotionAccentFor` stays the DISCRETE, AA-proven selector for
// text/ink (four quadrants, four safe inks); `auroraGlow` is its CONTINUOUS decorative twin — a
// bilinear blend over the whole valence×arousal disc, so the focal glow / tap dot / CTA re-tint
// smoothly as the finger travels instead of snapping between four flat quadrant colours.
//
// Axes match screenToCircumplex exactly: x = valence (+ right), y = arousal (+ up).
// Corners: TL violet (intense) · TR gold (joyful) · BL indigo (reflective) · BR sky (calm).
// It is decorative ONLY — it is never used as text, so it carries no AA obligation, and it must
// NEVER throw or emit a malformed colour (it feeds a Skia uniform every frame).

const HEX = /^#[0-9A-F]{6}$/;

// The origin colour — the mean of the four corners. Also the documented non-finite fallback.
const CENTER = '#8393B9';

describe('auroraGlow — the four Aurora corners', () => {
  it('pins each corner EXACTLY', () => {
    expect(auroraGlow(-1, 1)).toBe('#8B6FE8');  // TL −valence/+arousal → violet
    expect(auroraGlow(1, 1)).toBe('#F5B93A');   // TR +valence/+arousal → gold
    expect(auroraGlow(-1, -1)).toBe('#4B6FD0'); // BL −valence/−arousal → indigo
    expect(auroraGlow(1, -1)).toBe('#3FB4F0');  // BR +valence/−arousal → sky
  });

  // The engine must SPEAK THE TOKEN PALETTE — if a stop is re-tinted in tokens.ts and the engine
  // is not, the glow silently drifts away from the brand. These pins fail on any divergence.
  it('its corners ARE the Aurora token stops (no palette drift)', () => {
    expect(auroraGlow(1, -1)).toBe(emotionAnchors.calm);   // sky
    expect(auroraGlow(-1, 1)).toBe(emotionAnchors.coral);  // violet
    expect(auroraGlow(-1, -1)).toBe(emotionAnchors.peak);  // indigo
    expect(auroraGlow(1, 1)).toBe(colors.dark.accent.gold); // gold
  });

  it('exposes the corner triplets as data (0..255 integer channels)', () => {
    for (const key of ['intense', 'joyful', 'reflective', 'calm'] as const) {
      const c = AURORA_CORNERS[key];
      expect(c).toHaveLength(3);
      for (const ch of c) {
        expect(Number.isInteger(ch)).toBe(true);
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('auroraGlow — continuous bilinear interior', () => {
  it('blends the TOP edge (arousal +1) between violet and gold', () => {
    // midpoint of intense(139,111,232) and joyful(245,185,58) → (192,148,145)
    expect(auroraGlow(0, 1)).toBe('#C09491');
  });

  it('blends the BOTTOM edge (arousal −1) between indigo and sky', () => {
    // midpoint of reflective(75,111,208) and calm(63,180,240) → (69,146,224)
    expect(auroraGlow(0, -1)).toBe('#4592E0');
  });

  it('blends the LEFT and RIGHT edges across arousal', () => {
    expect(auroraGlow(-1, 0)).toBe('#6B6FDC'); // violet↔indigo midpoint
    expect(auroraGlow(1, 0)).toBe('#9AB795');  // gold↔sky midpoint
  });

  it('the origin is the mean of all four corners', () => {
    expect(auroraGlow(0, 0)).toBe(CENTER);
  });

  it('moves CONTINUOUSLY — a small step never jumps the colour (no quadrant snapping)', () => {
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    // step across the valence axis straddling 0, where a DISCRETE quadrant selector would snap
    let prev = channels(auroraGlow(-0.1, 0.5));
    for (const x of [-0.05, 0, 0.05, 0.1]) {
      const next = channels(auroraGlow(x, 0.5));
      for (let i = 0; i < 3; i++) expect(Math.abs(next[i] - prev[i])).toBeLessThanOrEqual(12);
      prev = next;
    }
  });
});

describe('auroraGlow — hostile input never reaches Skia as garbage', () => {
  it('CLAMPS out-of-range coordinates to the corner they point at', () => {
    expect(auroraGlow(99, -99)).toBe(auroraGlow(1, -1));   // sky
    expect(auroraGlow(-99, 99)).toBe(auroraGlow(-1, 1));   // violet
    expect(auroraGlow(-42, -42)).toBe(auroraGlow(-1, -1)); // indigo
  });

  it('degrades a non-finite coordinate to the neutral centre, never NaN', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(auroraGlow(bad, 0)).toBe(CENTER);
      expect(auroraGlow(0, bad)).toBe(CENTER);
      expect(auroraGlow(bad, bad)).toBe(CENTER);
    }
  });

  it('degrades missing / malformed input without throwing', () => {
    expect(() => auroraGlow(undefined as any, null as any)).not.toThrow();
    expect(auroraGlow(undefined as any, null as any)).toMatch(HEX);
    expect(auroraGlow('nope' as any, 'nope' as any)).toMatch(HEX);
  });

  it('ALWAYS emits a well-formed #RRGGBB across the whole disc (fuzz)', () => {
    for (let x = -1.5; x <= 1.5; x += 0.25) {
      for (let y = -1.5; y <= 1.5; y += 0.25) {
        const hex = auroraGlow(x, y);
        expect(hex).toMatch(HEX);
        // every channel is a real 0..255 byte — no '-1', no 'NaN', no 3-digit shorthand
        for (const i of [1, 3, 5]) {
          const ch = parseInt(hex.slice(i, i + 2), 16);
          expect(Number.isNaN(ch)).toBe(false);
          expect(ch).toBeGreaterThanOrEqual(0);
          expect(ch).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});
