const path = require('path');
const { parseTokenIndex, loadTokenIndex } = require('../lib/tokenIndex');

// The parser is what makes the lint messages useful: an error that only says "no literals"
// gets suppressed, one that says "#0E1030 is dark.surface.base" gets fixed. These tests pin
// the parse of a tokens-file SHAPE (nested consts, quoted keys, comments, `as const`), and a
// final pair asserts the shape holds for the real src/design/tokens.ts.

describe('parseTokenIndex — colours', () => {
  it('indexes a hex declared in a nested object by its full dotted path', () => {
    const idx = parseTokenIndex(`
      const dark = {
        surface: { base: '#0E1030' },
      };
    `);
    expect(idx.colorPath('#0E1030')).toBe('dark.surface.base');
  });

  it('matches a hex case-insensitively — #0e1030 is the same colour as #0E1030', () => {
    const idx = parseTokenIndex(`const dark = { surface: { base: '#0E1030' } };`);
    expect(idx.colorPath('#0e1030')).toBe('dark.surface.base');
  });

  it('expands 3-digit shorthand so #fff resolves to a declared #FFFFFF', () => {
    const idx = parseTokenIndex(`const light = { content: { primary: '#FFFFFF' } };`);
    expect(idx.colorPath('#fff')).toBe('light.content.primary');
  });

  it('indexes rgba() strings, ignoring internal whitespace', () => {
    const idx = parseTokenIndex(`
      const aurora = { glass: { day: { bg: 'rgba(255,255,255,0.52)' } } };
    `);
    expect(idx.colorPath('rgba(255, 255, 255, 0.52)')).toBe('aurora.glass.day.bg');
  });

  it('returns null for a colour no token declares', () => {
    const idx = parseTokenIndex(`const dark = { surface: { base: '#0E1030' } };`);
    expect(idx.colorPath('#3A5CCC')).toBeNull();
  });

  it('ignores strings that are not colours', () => {
    const idx = parseTokenIndex(`const type = { family: { display: 'GeneralSans-Semibold' } };`);
    expect(idx.colorPath('GeneralSans-Semibold')).toBeNull();
  });

  it('does not let a type annotation swallow the declaration name', () => {
    const idx = parseTokenIndex(`const dark: ColorScheme = { surface: { base: '#0E1030' } };`);
    expect(idx.colorPath('#0E1030')).toBe('dark.surface.base');
  });

  it('skips comments — a hex inside a comment is not a token', () => {
    const idx = parseTokenIndex(`
      // the old base was '#123456'
      /* and '#654321' before that */
      const dark = { surface: { base: '#0E1030' } };
    `);
    expect(idx.colorPath('#123456')).toBeNull();
    expect(idx.colorPath('#654321')).toBeNull();
    expect(idx.colorPath('#0E1030')).toBe('dark.surface.base');
  });

  it('keeps the brace stack balanced across an interface, so later consts keep their path', () => {
    const idx = parseTokenIndex(`
      export interface ColorScheme { surface: { base: Hex; raised: Hex } }
      export const emotionAnchors = { calm: '#3FB4F0' } as const;
    `);
    expect(idx.colorPath('#3FB4F0')).toBe('emotionAnchors.calm');
  });

  it('does not treat the `const` in `as const` as a new declaration', () => {
    const idx = parseTokenIndex(`
      export const a = { x: 1 } as const;
      export const b = { hue: '#3FB4F0' } as const;
    `);
    expect(idx.colorPath('#3FB4F0')).toBe('b.hue');
  });
});

describe('parseTokenIndex — numeric scales', () => {
  it('indexes a flat scale by value → token name', () => {
    const idx = parseTokenIndex(`
      export const space = { none: 0, xs: 4, sm: 8, md: 12, lg: 16 } as const;
    `);
    expect(idx.scaleName('space', 16)).toBe('space.lg');
    expect(idx.scaleName('space', 0)).toBe('space.none');
  });

  it('quotes-in-keys survive: `2xl` is a legal scale step', () => {
    const idx = parseTokenIndex(`export const space = { xl: 24, '2xl': 32 } as const;`);
    expect(idx.scaleName('space', 32)).toBe("space['2xl']");
  });

  it('reads fontSize from type.size and letterSpacing from type.tracking', () => {
    const idx = parseTokenIndex(`
      export const type = {
        size: { body: 16, caption: 11 },
        tracking: { display: -0.4, body: 0 },
      } as const;
    `);
    expect(idx.scaleName('fontSize', 16)).toBe('typography.size.body');
    expect(idx.scaleName('letterSpacing', -0.4)).toBe('typography.tracking.display');
  });

  it('reads borderWidth from the stroke scale', () => {
    const idx = parseTokenIndex(`export const stroke = { control: 1.5, glyph: 2.5 } as const;`);
    expect(idx.scaleName('borderWidth', 1.5)).toBe('stroke.control');
    expect(idx.scaleName('borderWidth', 2.5)).toBe('stroke.glyph');
  });

  it('names the nearest step when the value is off-scale', () => {
    const idx = parseTokenIndex(`export const space = { md: 12, lg: 16, xl: 24 } as const;`);
    expect(idx.nearestScaleStep('space', 15)).toEqual({ name: 'space.lg', value: 16 });
  });

  // A half-read number is the worst failure this scanner has: it does not throw, it names a
  // confidently WRONG token. Pin every numeric form JS/TS allows in a token file.
  it('reads numeric separators, exponents and hex without truncating them', () => {
    const idx = parseTokenIndex(
      `export const space = { a: 1_000, b: 1e3, c: 0x10, d: 2.5e-1 } as const;`);
    expect(idx.scaleName('space', 1000)).toBe('space.a');
    expect(idx.scaleName('space', 16)).toBe('space.c');
    expect(idx.scaleName('space', 0.25)).toBe('space.d');
  });

  it('returns null for a scale the tokens file does not declare', () => {
    const idx = parseTokenIndex(`export const space = { lg: 16 } as const;`);
    expect(idx.scaleName('radius', 16)).toBeNull();
    expect(idx.nearestScaleStep('radius', 16)).toBeNull();
  });

  it('lists a scale\u2019s steps so a message can spell out the options', () => {
    const idx = parseTokenIndex(`export const radius = { xs: 6, sm: 10, pill: 999 } as const;`);
    expect(idx.scaleSteps('radius')).toEqual(['radius.xs', 'radius.sm', 'radius.pill']);
  });
});

describe('parseTokenIndex — degraded input never throws', () => {
  it('returns an empty, queryable index for unparseable source', () => {
    const idx = parseTokenIndex('const broken = { "unterminated');
    expect(idx.colorPath('#0E1030')).toBeNull();
    expect(idx.scaleName('space', 16)).toBeNull();
  });
});

describe('loadTokenIndex — against the real design tokens', () => {
  const REAL = path.resolve(__dirname, '../../../src/design/tokens.ts');

  it('resolves the spacing and radius scales the screens actually use', () => {
    const idx = loadTokenIndex(REAL);
    expect(idx.scaleName('space', 16)).toBe('space.lg');
    expect(idx.scaleName('radius', 999)).toBe('radius.pill');
    expect(idx.scaleName('fontSize', 16)).toBe('typography.size.body');
    expect(idx.scaleName('borderWidth', 1.5)).toBe('stroke.control');
  });

  it('resolves a colour that is in the palette, and reports one that is not', () => {
    const idx = loadTokenIndex(REAL);
    expect(idx.colorPath('#0E1030')).toContain('surface.base');
    expect(idx.colorPath('#BADA55')).toBeNull();
  });

  // #3A5CCC is the colour that motivated this rule: it reached production styling as an
  // undeclared base-scope default. It has since been ADOPTED into the palette, so today the
  // rule's job is no longer "this is not a colour we own" but "you wrote the hex instead of
  // the token" — and the message has to name that token, or the literal just gets re-typed.
  it('names the token for the hex that started this — it is a real token now', () => {
    expect(loadTokenIndex(REAL).colorPath('#3A5CCC')).toBe('light.accent.bloom');
  });

  it('returns an empty index rather than throwing when the file is missing', () => {
    const idx = loadTokenIndex(path.resolve(__dirname, 'no-such-tokens.ts'));
    expect(idx.colorPath('#0E1030')).toBeNull();
  });
});
