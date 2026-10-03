import path from 'node:path';
import { readTokenSources } from '../lib/sources.mjs';
import { validateSources } from '../lib/schema.mjs';

// The token files' schema is the designer's, signed in the V1 addendum §2.1–§2.3 (plus the four
// keys of the copy-check amendment §4). These tests run the validator on the real files and on
// planted breakages of them. Every error has to name its file and its token path, because an
// error that does not say where it is gets fixed in the wrong place.

const DESIGN_TOKENS = path.resolve(__dirname, '../../../../../design-tokens');

type Source = { name: string; json: any };
const real = (): Source[] => readTokenSources(DESIGN_TOKENS).map((s: Source) => ({ name: s.name, json: s.json }));

/** The real sources, with one file's JSON changed by `edit`. */
function planted(file: string, edit: (json: any) => void): Source[] {
  return real().map((s) => {
    if (s.name !== file) return s;
    const json = structuredClone(s.json);
    edit(json);
    return { name: s.name, json };
  });
}

const errorsOf = (sources: Source[]): string[] => validateSources(sources).errors;
const ABYSS = 'direction.abyss.tokens.json';
const LINEN = 'direction.linen.tokens.json';
const BASE = 'base.tokens.json';

describe('the committed token files', () => {
  it('are the four files the schema names, and nothing else', () => {
    expect(readTokenSources(DESIGN_TOKENS).map((s: Source) => s.name)).toEqual([
      BASE,
      ABYSS,
      'direction.basin.tokens.json',
      LINEN,
    ]);
  });

  it('pass the schema', () => {
    expect(errorsOf(real())).toEqual([]);
  });
});

describe('key-set parity across the direction files', () => {
  it('a token missing from one direction is an error naming the file and the path', () => {
    const errors = errorsOf(planted(LINEN, (j) => delete j.color.dark.surface2));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.linen\.tokens\.json: color\.dark\.surface2: /));
  });

  it('a token only one direction has is an error', () => {
    const errors = errorsOf(planted(ABYSS, (j) => (j.field.extra = { $type: 'number', $value: 1 })));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: field\.extra: /));
  });

  it('the same path with a different type is an error', () => {
    const errors = errorsOf(planted(ABYSS, (j) => (j.plate.depth = { $type: 'dimension', $value: { value: 0, unit: 'px' } })));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: plate\.depth: .*type/));
  });
});

describe('every value is checked against its type, and the error names the path', () => {
  it.each([
    ['a colour with two components', (j: any) => (j.color.dark.surface2.$value.components = [0.2, 0.03])],
    ['a lightness above 1', (j: any) => (j.color.dark.surface2.$value.components = [1.2, 0.03, 240])],
    ['a hue of 360', (j: any) => (j.color.dark.surface2.$value.components = [0.24, 0.032, 360])],
    ['an alpha above 1', (j: any) => (j.color.dark.surface2.$value.alpha = 1.5)],
    ['a lower-case hex', (j: any) => (j.color.dark.surface2.$value.hex = '#10212d')],
    ['a colour space other than oklch', (j: any) => (j.color.dark.surface2.$value.colorSpace = 'srgb')],
  ])('%s', (_what, edit) => {
    expect(errorsOf(planted(ABYSS, edit))).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: color\.dark\.surface2: /));
  });

  it.each([
    ['a dimension not in px', (j: any) => (j.plate.inset.$value.unit = 'rem'), 'plate.inset'],
    ['a duration not in ms', (j: any) => (j.field.stillTime.$value.unit = 's'), 'field.stillTime'],
    ['a number that is not finite', (j: any) => (j.field.pivot.$value = null), 'field.pivot'],
    ['a font weight off the 100–900 scale', (j: any) => (j.type.ui.title.weight.$value = 450), 'type.ui.title.weight'],
    ['a string that is not a string', (j: any) => (j.haptics.place.$value = 5), 'haptics.place'],
    ['an unknown type', (j: any) => (j.field.pivot.$type = 'percentage'), 'field.pivot'],
    ['a shadow layer without a colour', (j: any) => (j.elevation.e2.light.$value = [{ offsetX: 0 }]), 'elevation.e2.light'],
  ])('%s', (_what, edit, tokenPath) => {
    const pattern = new RegExp(`^direction\\.abyss\\.tokens\\.json: ${tokenPath.replace(/\./g, '\\.')}: `);
    expect(errorsOf(planted(ABYSS, edit))).toContainEqual(expect.stringMatching(pattern));
  });

  it('an easing whose x is outside [0, 1] is an error', () => {
    const errors = errorsOf(planted(BASE, (j) => (j.motion.pop.easing.$value = [1.2, 1.56, 0.64, 1])));
    expect(errors).toContainEqual(expect.stringMatching(/^base\.tokens\.json: motion\.pop\.easing: /));
  });
});

describe('hexes', () => {
  // Addendum §2.1: a hex the developer computed is checked against the colour core exactly.
  it('a generated hex that disagrees with the colour core is an error that says what it should be', () => {
    const errors = errorsOf(planted(ABYSS, (j) => (j.color.dark.surface2.$value.hex = '#10212E')));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: color\.dark\.surface2: .*#10212D/));
  });

  // V0's hexes were hand-computed "to about ±1 per channel" (v0-spec caveat 2); the designer's
  // rule is to copy them. One step off is reported as a note for the designer, two is an error.
  it('a hex copied from V0 may be one step off the core, and each such hex is listed', () => {
    const { errors, notes } = validateSources(real());
    expect(errors).toEqual([]);
    expect(notes).toEqual([
      expect.stringMatching(/^direction\.linen\.tokens\.json: color\.dark\.ground: .*#130F0A.*#130E0B/),
      expect.stringMatching(/^direction\.linen\.tokens\.json: color\.dark\.bead\.shadow: .*#130F0A.*#130E0B/),
    ]);
  });

  it('a V0 hex two steps off the core is an error', () => {
    const errors = errorsOf(planted(LINEN, (j) => (j.color.dark.ground.$value.hex = '#130F08')));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.linen\.tokens\.json: color\.dark\.ground: /));
  });

  it('a hex with no generated-or-v0 marker is an error', () => {
    const errors = errorsOf(planted(ABYSS, (j) => delete j.color.dark.surface2.$extensions));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: color\.dark\.surface2: .*marker/));
  });

  it('a colour outside sRGB is an error', () => {
    const errors = errorsOf(
      planted(ABYSS, (j) => {
        j.color.dark.surface2.$value.components = [0.7, 0.4, 150];
      }),
    );
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: color\.dark\.surface2: .*gamut/));
  });
});

describe('aliases', () => {
  it('an alias to a token that does not exist is an error', () => {
    const errors = errorsOf(planted(ABYSS, (j) => (j.color.dark.focus.$value = '{color.dark.text.missing}')));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: color\.dark\.focus: .*color\.dark\.text\.missing/));
  });

  it('an alias to a token of another type is an error', () => {
    const errors = errorsOf(planted(ABYSS, (j) => (j.color.dark.focus.$value = '{plate.inset}')));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: color\.dark\.focus: /));
  });

  it('an alias cycle is an error', () => {
    const errors = errorsOf(
      planted(ABYSS, (j) => {
        j.color.dark.text.onTint.$value = '{color.dark.text.onInk}';
        j.color.dark.text.onInk.$value = '{color.dark.text.onTint}';
      }),
    );
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: color\.dark\.text\.on(Tint|Ink): .*cycle/));
  });
});

describe('locks and the owner’s pending decisions', () => {
  it('a top-level group without a lock is an error', () => {
    const errors = errorsOf(planted(ABYSS, (j) => delete j.radius.$extensions));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: radius: .*lock/));
  });

  it('the never-red band is the owner’s (DEC-081) and marked proposed', () => {
    const noStatus = errorsOf(planted(BASE, (j) => delete j.neverRed.$extensions['com.kokonada'].status));
    expect(noStatus).toContainEqual(expect.stringMatching(/^base\.tokens\.json: neverRed: .*proposed/));
    const designerLock = errorsOf(planted(BASE, (j) => (j.neverRed.$extensions['com.kokonada'].lock = 'designer')));
    expect(designerLock).toContainEqual(expect.stringMatching(/^base\.tokens\.json: neverRed: .*owner:DEC-081/));
  });

  it('the tiers are the owner’s (DEC-084)', () => {
    const errors = errorsOf(planted(BASE, (j) => (j.field.tiers.$extensions['com.kokonada'].lock = 'designer')));
    expect(errors).toContainEqual(expect.stringMatching(/^base\.tokens\.json: field\.tiers: .*owner:DEC-084/));
  });
});

// Copy-check amendment §4: "The schema rejects any direction's nRest above nMax or nStress below
// nMin." n = 12 is the 0.2 Hz cap (5.0 s), n = 6 the 10 s ceiling.
describe('breath cycle bounds read from base', () => {
  it('rejects nRest above field.clock.breath.nMax', () => {
    const errors = errorsOf(planted(ABYSS, (j) => (j.field.breath.nRest.$value = 13)));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: field\.breath\.nRest: .*12/));
  });

  it('rejects nStress below field.clock.breath.nMin', () => {
    const errors = errorsOf(planted(ABYSS, (j) => (j.field.breath.nStress.$value = 5)));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: field\.breath\.nStress: .*6/));
  });
});

describe('the set of files', () => {
  it('needs a base file', () => {
    const errors = errorsOf(real().filter((s) => s.name !== BASE));
    expect(errors).toContainEqual(expect.stringMatching(/base\.tokens\.json/));
  });

  it('refuses a file name the schema does not know', () => {
    const errors = errorsOf([...real(), { name: 'direction.extra.json', json: {} }]);
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.extra\.json: /));
  });
});
