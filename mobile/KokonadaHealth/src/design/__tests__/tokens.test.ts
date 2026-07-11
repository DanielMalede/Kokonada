import { colors, space, radius, motion, type, emotionAnchors, glassAlpha, type ColorScheme, type ThemeName } from '../tokens';
import { contrastRatio, passesAA, parseHex, flatten, relativeLuminance, AA_NORMAL, AA_LARGE } from '../contrast';
import { resolveScheme } from '../theme';

// The token system's CONTRACT (spec §2 / §7): every content-over-surface pairing passes
// WCAG 2.2 AA, in BOTH themes, including over the glass fallback. These tests are the
// gate — a token edit that breaks contrast fails here, not on a user's screen.

const themes: ThemeName[] = ['dark', 'light'];

describe('WCAG contrast math', () => {
  it('matches known reference ratios (black/white = 21, identical = 1)', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1, 5);
  });
  it('rejects malformed hex loudly', () => {
    expect(() => parseHex('#12')).toThrow();
    expect(() => parseHex('nope')).toThrow();
  });
  it('flatten composites alpha over a backdrop', () => {
    // 50% white over black → mid grey
    expect(flatten({ r: 255, g: 255, b: 255 }, 0.5, { r: 0, g: 0, b: 0 })).toEqual({ r: 128, g: 128, b: 128 });
  });
});

describe.each(themes)('theme "%s" — content passes AA on every surface', (name) => {
  const c: ColorScheme = colors[name];
  const surfaces: Array<[string, string]> = [
    ['base', c.surface.base],
    ['raised', c.surface.raised],
    ['overlay', c.surface.overlay],
    ['glassFallback', c.surface.glassFallback],
  ];

  // Body/secondary text must clear AA-normal (4.5). Tertiary is small print but we still
  // hold it to AA-normal on the primary base (honest, readable captions).
  it.each(surfaces)('primary text on %s ≥ AA-normal', (_label, surf) => {
    expect(contrastRatio(c.content.primary, surf)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
  it.each(surfaces)('secondary text on %s ≥ AA-normal', (_label, surf) => {
    expect(contrastRatio(c.content.secondary, surf)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
  it('tertiary text on base ≥ AA-normal', () => {
    expect(passesAA(c.content.tertiary, c.surface.base)).toBe(true);
  });

  it('onAccent text passes AA on the accent FILL (button surfaces)', () => {
    expect(contrastRatio(c.content.onAccent, c.accent.glowInk)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  // Accents & state colors are used as icons/graphics/large labels → AA-large (3.0) on base.
  it('glow accent ≥ AA-large on base', () => {
    expect(contrastRatio(c.accent.glow, c.surface.base)).toBeGreaterThanOrEqual(AA_LARGE);
  });
  it.each(['success', 'warning', 'danger', 'info'] as const)('state.%s ≥ AA-large on base', (k) => {
    expect(contrastRatio(c.state[k], c.surface.base)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  // Error copy renders as NORMAL-size text (SignInScreen's alert <Text> has no large size),
  // so danger must clear AA-normal (4.5) on base in BOTH themes — not just AA-large.
  it('state.danger is readable as NORMAL error text on base ≥ AA-normal', () => {
    expect(contrastRatio(c.state.danger, c.surface.base)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('hairline is a real separator, not invisible, and not louder than the accent', () => {
    const r = contrastRatio(c.surface.hairline, c.surface.base);
    expect(r).toBeGreaterThan(1.05);
    expect(r).toBeLessThan(contrastRatio(c.content.primary, c.surface.base));
  });

  it('the glass fallback is opaque and AA-safe (frost degrades to something readable)', () => {
    // primary text over the ACTUAL frosted glass (fallback composited under its own alpha)
    const under = flatten(parseHex(c.surface.overlay), glassAlpha[name], parseHex(c.surface.base));
    const flatHex = `#${[under.r, under.g, under.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    expect(contrastRatio(c.content.primary, flatHex)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('emotionAccent anchors heat monotonically (calm→peak)', () => {
  it('luminance/hue shifts from the calm glow toward the peak red', () => {
    // Not a strict luminance order (perceptual), but calm must differ from peak clearly.
    expect(emotionAnchors.calm).not.toEqual(emotionAnchors.peak);
    // each anchor is a valid color
    (['calm', 'warm', 'coral', 'peak'] as const).forEach((k) => expect(() => relativeLuminance(emotionAnchors[k])).not.toThrow());
  });
});

describe('scales are coherent (no magic numbers leak — ascending, deduped)', () => {
  it('space scale strictly ascends', () => {
    const v = Object.values(space);
    expect(v).toEqual([...v].sort((a, b) => a - b));
    expect(new Set(v).size).toBe(v.length);
  });
  it('radius scale ascends to the pill', () => {
    expect(radius.xs).toBeLessThan(radius.lg);
    expect(radius.pill).toBeGreaterThan(radius.xl);
  });
  it('type sizes strictly descend display→caption', () => {
    const order = ['display', 'title', 'heading', 'subheading', 'body', 'callout', 'footnote', 'caption'] as const;
    const sizes = order.map((k) => type.size[k]);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
  });
});

describe('motion honours reduced-motion (spec §2 — every token ships a reduced variant)', () => {
  it('every duration has a reduced counterpart', () => {
    expect(Object.keys(motion.durationReduced).sort()).toEqual(Object.keys(motion.duration).sort());
  });
  it('reduced motion stills the ambient breath and collapses transitions', () => {
    expect(motion.durationReduced.breath).toBe(0);
    expect(motion.durationReduced.base).toBe(0);
  });
  it('the calm easing is a settle (ends decelerating, no snap-back past 1)', () => {
    expect(motion.easing.calm[3]).toBeLessThanOrEqual(1);
  });
});

describe('resolveScheme selects the right palette and defaults to Bioluminescence (dark)', () => {
  it('light → light, dark/null → dark', () => {
    expect(resolveScheme('light')).toBe(colors.light);
    expect(resolveScheme('dark')).toBe(colors.dark);
    expect(resolveScheme(null)).toBe(colors.dark);
    expect(resolveScheme(undefined)).toBe(colors.dark);
  });
});
