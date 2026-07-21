import { colors, space, radius, motion, type, fontFace, emotionAnchors, glassAlpha, type ColorScheme, type ThemeName } from '../tokens';
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

describe('emotionAnchors stay in the cool Aurora band (HR aura ramp — NEVER alarming red)', () => {
  it('the ramp is sky→indigo: calm differs from peak, every anchor is valid, and NONE is warm/red', () => {
    // Not a strict luminance order (perceptual), but calm must differ from peak clearly.
    expect(emotionAnchors.calm).not.toEqual(emotionAnchors.peak);
    // each anchor is a valid color
    (['calm', 'warm', 'coral', 'peak'] as const).forEach((k) => expect(() => relativeLuminance(emotionAnchors[k])).not.toThrow());
    // regulator ethic in the TOKEN: blue channel dominates red at EVERY anchor, so no warm/red hue
    // can ever leak into the HR aura ramp — the never-red guarantee is a value invariant, not a comment.
    (['calm', 'warm', 'coral', 'peak'] as const).forEach((k) => {
      const { r, b } = parseHex(emotionAnchors[k]);
      expect(b).toBeGreaterThanOrEqual(r);
    });
  });
  it('carries the exact Aurora sky→indigo values', () => {
    expect(emotionAnchors).toEqual({ calm: '#3FB4F0', warm: '#6FA6EC', coral: '#8B6FE8', peak: '#4B6FD0' });
  });
});

describe('Aurora foundation tokens (the LOCKED direction — exact pins so the palette cannot drift)', () => {
  it('content.muted (the mockup --mut supporting-text hue) — exact, both themes', () => {
    expect(colors.dark.content.muted).toBe('#A7A6D0');
    expect(colors.light.content.muted).toBe('#6A6589');
  });
  it('accent.goldInk (the gold-signature text ink) — exact, both themes', () => {
    expect(colors.dark.accent.goldInk).toBe('#FFD37A');
    expect(colors.light.accent.goldInk).toBe('#8A5A12');
  });
  it('surface.textScrim base + alpha ramp (aura-over-text legibility veil) — exact, both themes', () => {
    expect(colors.dark.surface.textScrim).toEqual({ base: '#0A0C28', from: 0, to: 0.55 });
    expect(colors.light.surface.textScrim).toEqual({ base: '#F3F4FE', from: 0, to: 0.6 });
  });
  it('the new Aurora surface fields (canvas gradient / gold hairline / veil) — exact, both themes', () => {
    expect(colors.dark.surface.canvasTop).toBe('#0E1030');
    expect(colors.dark.surface.canvasBottom).toBe('#080A20');
    expect(colors.dark.surface.veilColor).toBe('#0A0C28');
    expect(colors.light.surface.canvasTop).toBe('#FAFAFF');
    expect(colors.light.surface.canvasBottom).toBe('#EEF1FC');
    expect(colors.light.surface.veilColor).toBe('#F5F6FF');
    // the gold hairline frame is the SAME 30% gold in both themes
    expect(colors.dark.surface.hairlineGold).toBe('rgba(212,175,95,0.30)');
    expect(colors.light.surface.hairlineGold).toBe('rgba(212,175,95,0.30)');
  });
  it('aurora blobs / motion / glass — shared hues in both themes, exact', () => {
    for (const name of themes) {
      const a = colors[name].aurora;
      expect(a.blobs).toEqual({
        sky: { color: '#5EC8F5', alpha: 0.9 },
        violet: { color: '#9B7BF0', alpha: 0.85 },
        gold: { color: '#FFCB6E', alpha: 0.85 },
        pink: { color: '#F79AC0', alpha: 0.45 },
      });
      expect(a.blur).toBe(15);
      expect(a.flow).toBe(15000);
      expect(a.focalGlow).toBe(4600);
      // both glass variants are exposed from either theme (light = Day, Nocturne = night)
      expect(a.glass.day).toEqual({ bg: 'rgba(255,255,255,0.52)', blur: 10, border: 'rgba(255,255,255,0.66)' });
      expect(a.glass.night).toEqual({ bg: 'rgba(255,255,255,0.10)', blur: 10, border: 'rgba(255,255,255,0.18)' });
    }
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
  it('display + text faces are the bundled Manrope, not the System placeholder', () => {
    // AURORA replaced General Sans with Manrope app-wide: one face carries the wordmark,
    // headlines and body copy, so display and text must both resolve to it.
    expect(type.family.display).toBe('Manrope');
    expect(type.family.text).toBe('Manrope');
    expect(type.family.display).not.toBe('System');
    expect(type.family.display).not.toBe('GeneralSans-Semibold');
    // the technical/mono stack is deliberately kept for code-like labels.
    expect(type.family.mono).toBe('monospace');
  });
  it('the weight ramp carries an extrabold (800) for Aurora headlines', () => {
    expect(type.weight.extrabold).toBe('800');
    // the ramp still ascends regular→extrabold as numeric strings.
    const ramp = [type.weight.regular, type.weight.medium, type.weight.semibold, type.weight.bold, type.weight.extrabold];
    expect(ramp).toEqual(['400', '500', '600', '700', '800']);
  });
  it('exposes exact per-weight Manrope faces (Android weight-resolution fallback)', () => {
    // RN 0.86 on Android can mis-select a weight from `fontFamily:"Manrope" + fontWeight`;
    // each named face maps 1:1 to a bundled TTF so a component can pin the exact face.
    expect(fontFace).toEqual({
      regular: 'Manrope-Regular',
      medium: 'Manrope-Medium',
      semibold: 'Manrope-SemiBold',
      bold: 'Manrope-Bold',
      extrabold: 'Manrope-ExtraBold',
    });
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
  it('the Aurora flow + focal-glow durations live in BOTH maps (reduced stills them)', () => {
    expect(motion.duration.flow).toBe(15000);      // ambient aurora drift (~15s)
    expect(motion.duration.focalGlow).toBe(4600);  // the focal-glow breath (~4.6s)
    expect(motion.durationReduced.flow).toBe(0);
    expect(motion.durationReduced.focalGlow).toBe(0);
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
