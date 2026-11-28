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
const BASE = 'base.tokens.json';
const SECOND = 'direction.second.tokens.json';
const THIRD = 'direction.third.tokens.json';

/**
 * The real sources plus two in-memory copies of Abyss as further directions (never files in
 * design-tokens/): key-set parity needs at least three directions to say which one is wrong.
 * `edit` changes the third.
 */
function trio(edit: (json: any) => void = () => {}): Source[] {
  const sources = real();
  const abyss = sources.find((s) => s.name === ABYSS)!.json;
  const third = structuredClone(abyss);
  edit(third);
  return [...sources, { name: SECOND, json: structuredClone(abyss) }, { name: THIRD, json: third }];
}

describe('the committed token files', () => {
  // The close-out (Abyss only): exactly the base file and Abyss's.
  it('are the base file and Abyss’s, and nothing else', () => {
    expect(readTokenSources(DESIGN_TOKENS).map((s: Source) => s.name)).toEqual([BASE, ABYSS]);
  });

  it('pass the schema', () => {
    expect(errorsOf(real())).toEqual([]);
  });
});

describe('key-set parity across the direction files', () => {
  it('three copies of Abyss pass, so the plants below are what fails', () => {
    expect(errorsOf(trio())).toEqual([]);
  });

  it('a token missing from one direction is an error naming the file and the path', () => {
    const errors = errorsOf(trio((j) => delete j.color.dark.surface2));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.third\.tokens\.json: color\.dark\.surface2: /));
  });

  it('a token only one direction has is an error', () => {
    const errors = errorsOf(trio((j) => (j.field.extra = { $type: 'number', $value: 1 })));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.third\.tokens\.json: field\.extra: /));
  });

  it('the same path with a different type is an error', () => {
    const errors = errorsOf(trio((j) => (j.plate.depth = { $type: 'dimension', $value: { value: 0, unit: 'px' } })));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.third\.tokens\.json: plate\.depth: .*type/));
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
  // None is left in the committed files; the planted one shows the note still works.
  it('a hex copied from V0 may be one step off the core, and each such hex is listed', () => {
    expect(validateSources(real()).notes).toEqual([]);
    const { errors, notes } = validateSources(planted(ABYSS, (j) => (j.color.dark.surface1.$value.hex = '#081823')));
    expect(errors).toEqual([]);
    expect(notes).toEqual([expect.stringMatching(/^direction\.abyss\.tokens\.json: color\.dark\.surface1: .*#081823.*#081822/)]);
  });

  it('a V0 hex two steps off the core is an error', () => {
    const errors = errorsOf(planted(ABYSS, (j) => (j.color.dark.ground.$value.hex = '#030C17')));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: color\.dark\.ground: /));
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

  // DEC-081 is decided: a closed band, red iff the hue is in the band (ends inclusive) and C >= floor.
  it('the never-red band is the owner’s (DEC-081), marked decided, with its rule sentence', () => {
    const noStatus = errorsOf(planted(BASE, (j) => delete j.neverRed.$extensions['com.kokonada'].status));
    expect(noStatus).toContainEqual(expect.stringMatching(/^base\.tokens\.json: neverRed: .*decided/));
    const stillProposed = errorsOf(planted(BASE, (j) => (j.neverRed.$extensions['com.kokonada'].status = 'proposed')));
    expect(stillProposed).toContainEqual(expect.stringMatching(/^base\.tokens\.json: neverRed: .*decided/));
    const otherRule = errorsOf(planted(BASE, (j) => (j.neverRed.$extensions['com.kokonada'].rule = 'red iff C > floor')));
    expect(otherRule).toContainEqual(expect.stringMatching(/^base\.tokens\.json: neverRed: .*rule/));
    const designerLock = errorsOf(planted(BASE, (j) => (j.neverRed.$extensions['com.kokonada'].lock = 'designer')));
    expect(designerLock).toContainEqual(expect.stringMatching(/^base\.tokens\.json: neverRed: .*owner:DEC-081/));
  });

  it('the tiers are the owner’s (DEC-084)', () => {
    const errors = errorsOf(planted(BASE, (j) => (j.field.tiers.$extensions['com.kokonada'].lock = 'designer')));
    expect(errors).toContainEqual(expect.stringMatching(/^base\.tokens\.json: field\.tiers: .*owner:DEC-084/));
  });

  // DEC-084 is decided for the tier table (the owner, 2026-11-16); DEC-165 holds the rest of its question.
  it('the tier table is marked decided (DEC-084)', () => {
    const noStatus = errorsOf(planted(BASE, (j) => delete j.field.tiers.$extensions['com.kokonada'].status));
    expect(noStatus).toContainEqual(expect.stringMatching(/^base\.tokens\.json: field\.tiers: .*decided/));
    const stillProposed = errorsOf(planted(BASE, (j) => (j.field.tiers.$extensions['com.kokonada'].status = 'proposed')));
    expect(stillProposed).toContainEqual(expect.stringMatching(/^base\.tokens\.json: field\.tiers: .*decided/));
  });
});

// Designer B2 review §5 and §1c.
describe('type and motion rules', () => {
  it('a weight of 300 needs a size of at least 20, across the base and direction files', () => {
    const small = errorsOf(planted(BASE, (j) => (j.type.ui.display.latin.size.$value.value = 18)));
    expect(small).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: type\.ui\.display\.weight: .*20/));
    const body = errorsOf(planted(BASE, (j) => (j.type.ui.body.latin.weight.$value = 300)));
    expect(body).toContainEqual(expect.stringMatching(/^base\.tokens\.json: type\.ui\.body\.latin\.weight: .*20/));
  });

  it('Hebrew tracking is never negative, in either file', () => {
    const base = errorsOf(planted(BASE, (j) => (j.type.ui.title.hebrew.tracking.$value = -0.01)));
    expect(base).toContainEqual(expect.stringMatching(/^base\.tokens\.json: type\.ui\.title\.hebrew\.tracking: /));
    const direction = errorsOf(planted(ABYSS, (j) => (j.type.voice.l.hebrew.tracking.$value = -0.01)));
    expect(direction).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: type\.voice\.l\.hebrew\.tracking: /));
  });

  it('motion.placement.easing names a motion the base file has', () => {
    const errors = errorsOf(planted(ABYSS, (j) => (j.motion.placement.easing.$value = 'motion.nope')));
    expect(errors).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: motion\.placement\.easing: .*motion\.nope/));
    expect(errorsOf(planted(ABYSS, (j) => (j.motion.placement.easing.$value = 'motion.respond')))).toEqual([]);
  });
});

// Designer edge-ink gaps §a: on the light face every shadow colour that is not black or white is
// that face's text.primary, so the shadows follow the ink if it ever changes again.
describe('light-face shadows follow the ink', () => {
  const shadowRule = (errors: string[]) => errors.filter((e) => /text\.primary/.test(e));
  // Abyss's elevations draw no layer, so the rule is shown on a planted one.
  const layer = (components: number[]) => ({
    color: { colorSpace: 'oklch', components, alpha: 0.1, hex: '#000000' },
    offsetX: { value: 0, unit: 'px' }, offsetY: { value: 2, unit: 'px' }, blur: { value: 0, unit: 'px' }, spread: { value: 0, unit: 'px' }, inset: false,
  });

  it('a light bead.shadow that is not text.primary is an error', () => {
    const errors = errorsOf(planted(ABYSS, (j) => (j.color.light.bead.shadow.$value.components = [0.24, 0.02, 60])));
    expect(shadowRule(errors)).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: color\.light\.bead\.shadow: /));
  });

  it('a light elevation layer that is not text.primary is an error; a black one is not', () => {
    const errors = errorsOf(planted(ABYSS, (j) => (j.elevation.raised.light.$value = [layer([0.25, 0.02, 65])])));
    expect(shadowRule(errors)).toContainEqual(expect.stringMatching(/^direction\.abyss\.tokens\.json: elevation\.raised\.light: /));
    expect(shadowRule(errorsOf(planted(ABYSS, (j) => (j.elevation.raised.light.$value = [layer([0, 0, 0])]))))).toEqual([]);
  });

  it('black and white shadows are allowed', () => {
    const black = errorsOf(planted(ABYSS, (j) => (j.color.light.bead.shadow.$value.components = [0, 0, 0])));
    const white = errorsOf(planted(ABYSS, (j) => (j.color.light.bead.shadow.$value.components = [1, 0, 0])));
    expect(shadowRule(black)).toEqual([]);
    expect(shadowRule(white)).toEqual([]);
  });
});

// DSN-035's change limit, counted in breath steps (designer rulings §2; resilience second voice
// §1.5): the code implements one step per wrap when slowing, and a whole number of wraps per step
// when speeding back up.
describe('breath.changeLimit', () => {
  it('slowerStepsPerWrap must be 1, the only value the phaser implements', () => {
    const errors = errorsOf(planted(BASE, (j) => (j.breath.changeLimit.slowerStepsPerWrap.$value = 2)));
    expect(errors).toContainEqual(expect.stringMatching(/^base\.tokens\.json: breath\.changeLimit\.slowerStepsPerWrap: /));
  });

  it.each([0, 1.5, -1])('fasterWrapsPerStep must be a whole number of at least 1, not %p', (value) => {
    const errors = errorsOf(planted(BASE, (j) => (j.breath.changeLimit.fasterWrapsPerStep.$value = value)));
    expect(errors).toContainEqual(expect.stringMatching(/^base\.tokens\.json: breath\.changeLimit\.fasterWrapsPerStep: /));
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

// The close-out: the base file's per-direction data (each `directions` list, each `sample` map) names
// only directions that have a file, so a retired direction cannot linger there.
describe('the base file names only existing directions', () => {
  const surfaces = (j: any) => j.$extensions['com.kokonada'].opaqueSurfaces.surfaces;
  const RETIRED = ['nenil'].map((w) => [...w].reverse().join(''))[0];

  it('a planted retired id in a directions list is an error naming the path and the id', () => {
    const errors = errorsOf(planted(BASE, (j) => surfaces(j)[0].directions.push(RETIRED)));
    expect(errors).toEqual([`base.tokens.json: $extensions.com.kokonada.opaqueSurfaces.surfaces[0].directions: names direction "${RETIRED}", which has no direction file`]);
  });

  it('a planted retired key in a sample map is an error', () => {
    const errors = errorsOf(planted(BASE, (j) => (surfaces(j).find((x: any) => typeof x.sample === 'object').sample[RETIRED] = 'a planted sample')));
    expect(errors).toEqual([expect.stringMatching(new RegExp(`\\.sample: names direction "${RETIRED}", which has no direction file$`))]);
  });

  it('a direction that has a file may be named: the in-memory copies pass when the base names them', () => {
    const sources = trio().map((x) => (x.name === BASE ? { ...x, json: structuredClone(x.json) } : x));
    surfaces(sources.find((x) => x.name === BASE)!.json)[0].directions.push('second', 'third');
    expect(errorsOf(sources)).toEqual([]);
  });
});

// UI-112 (the owner's option (b)): field.rest's lobes are one table for both faces, or one per face,
// { dark, light }. Abyss's are per face; fixture-inner keeps the one-table form.
describe('field.rest’s lobes: one table, or one per face', () => {
  const lobes = (j: any) => j.field.rest.$extensions['com.kokonada'];
  const PATH = /^direction\.abyss\.tokens\.json: field\.rest: /;

  it('Abyss’s committed table is per face, and passes', () => {
    expect(Object.keys(lobes(real().find((s) => s.name === ABYSS)!.json).lobes).sort()).toEqual(['dark', 'light']);
    expect(errorsOf(real())).toEqual([]);
  });

  it('one table for both faces passes too', () => {
    expect(errorsOf(planted(ABYSS, (j) => (lobes(j).lobes = [[0, 0]])))).toEqual([]);
  });

  it.each([
    ['a per-face table missing the light face', { dark: [[0, 0]] }],
    ['a per-face table missing the dark face', { light: [[0, 0]] }],
    ['a per-face table holding another key', { dark: [[0, 0]], light: [[0, 0]], dim: [[0, 0]] }],
    ['a face whose table is empty', { dark: [[0, 0]], light: [] }],
    ['a face whose lobe is not two finite numbers', { dark: [[0, 0]], light: [[0, 'x']] }],
    ['a lobe of three numbers', [[0, 0, 0]]],
    ['an empty table', []],
    ['a table that is neither a list nor a per-face object', 0.5],
    ['no table at all', undefined],
  ])('%s is an error naming the file and field.rest', (_, value) => {
    const errors = errorsOf(planted(ABYSS, (j) => (lobes(j).lobes = value)));
    expect(errors).toContainEqual(expect.stringMatching(PATH));
  });
});

// DEC-172, G4 (the architect's Fork 1, with the designer's corrected lobe bound and the architect's re-rule of at
// most two rest lobes): the field's runtime statics are checked at generation, and each planted break is refused
// with an error naming its file and the group that holds it.
describe('G4: the field’s runtime statics are checked at generation (DEC-172)', () => {
  const extensionAt = (j: any, groupPath: string) => groupPath.split('.').reduce((node, k) => node[k], j).$extensions['com.kokonada'];
  /** The planted source draws an error that names the file and the group and says what is wrong (`complaint`). */
  const refused = (file: string, group: string, edit: (j: any) => void, complaint: RegExp) => {
    const at = `${file}: ${group}: `;
    const errors = errorsOf(planted(file, edit));
    expect(errors.filter((e) => e.startsWith(at) && complaint.test(e.slice(at.length)))).not.toEqual([]);
  };

  describe('the rest lobes: one or two per table, each within centreAlpha + centreBeta of the centre', () => {
    const lobes = (j: any) => extensionAt(j, 'field.rest');

    it.each([
      ['three lobes on one face', (j: any) => (lobes(j).lobes.light = [[0, 0], [0.1, 0], [0.2, 0]]), /^lobes\.light: at most 2 rest lobes/],
      ['three lobes in a table for both faces', (j: any) => (lobes(j).lobes = [[0, 0], [0.1, 0], [0.2, 0]]), /^lobes: at most 2 rest lobes/],
      ['a lobe beyond the bound (|c| = 1.006, the bound 1)', (j: any) => (lobes(j).lobes.dark = [[0.8, 0.61]]), /^lobes\.dark\[0\]: .*centreAlpha \+ centreBeta = 1 /],
      ['a lobe beyond a lowered bound (centreAlpha 0.4, a light lobe at 0.53)', (j: any) => (j.field.lobe.centreAlpha.$value = 0.4), /^lobes\.light\[1\]: .*= 0\.4 /],
      ['a bound the file does not hold', (j: any) => delete j.field.lobe.centreBeta, /bounded by field\.lobe\.centreAlpha \+ field\.lobe\.centreBeta/],
    ])('%s is refused, naming field.rest', (_what, edit, complaint) => {
      refused(ABYSS, 'field.rest', edit, complaint);
    });

    it('a lobe exactly on the bound passes, and the bound is the direction’s own sum (centreBeta widens it)', () => {
      expect(errorsOf(planted(ABYSS, (j) => (lobes(j).lobes.dark = [[0.6, 0.8]])))).toEqual([]);
      refused(ABYSS, 'field.rest', (j) => (lobes(j).lobes.dark = [[0, 1.1]]), /centreAlpha \+ centreBeta = 1 /);
      expect(
        errorsOf(
          planted(ABYSS, (j) => {
            j.field.lobe.centreBeta.$value = 0.12;
            lobes(j).lobes.dark = [[0, 1.1]];
          }),
        ),
      ).toEqual([]);
    });
  });

  describe('the drift tables: slots lobe0, lobe1 … in both, harmonics whole and positive, phases finite', () => {
    const drift = (j: any) => extensionAt(j, 'field.clock').drift;

    it.each([
      ['a harmonic that is not a whole number', (j: any) => (drift(j).harmonics.lobe1 = [3, 2.5]), /^drift\.harmonics\.lobe1: .*whole harmonics/],
      ['a harmonic of 0', (j: any) => (drift(j).harmonics.lobe0 = [0, 3]), /^drift\.harmonics\.lobe0: .*at least 1/],
      ['a negative harmonic', (j: any) => (drift(j).harmonics.lobe2 = [-1, 2]), /^drift\.harmonics\.lobe2: .*at least 1/],
      ['a harmonic of three numbers', (j: any) => (drift(j).harmonics.lobe2 = [1, 2, 3]), /^drift\.harmonics\.lobe2: \[kx, ky\]/],
      ['a phase that is not finite', (j: any) => (drift(j).phases.lobe2 = [2.1, null]), /^drift\.phases\.lobe2: .*finite phases/],
      ['a phase slot the harmonics lack', (j: any) => (drift(j).phases.lobe3 = [0, 0]), /^drift\.phases: the same slots as drift\.harmonics/],
      ['slots not named lobe0, lobe1 …', (j: any) => Object.assign(drift(j), { harmonics: { a: [1, 1] }, phases: { a: [0, 0] } }), /^drift\.harmonics: the slots are lobe0, lobe1/],
      ['no drift table', (j: any) => delete extensionAt(j, 'field.clock').drift, /^drift: the drift tables/],
    ])('%s is refused, naming field.clock', (_what, edit, complaint) => {
      refused(BASE, 'field.clock', edit, complaint);
    });
  });

  describe('the fallback stops: positions rise strictly from 0 to 1, weights in [0, 1] never rise, the lists as long', () => {
    const stops = (j: any) => extensionAt(j, 'field.fallback').stops;

    it.each([
      ['positions that do not start at 0', (j: any) => (stops(j).position[0] = 0.1), /^stops\.position: runs from 0 to 1/],
      ['positions that do not end at 1', (j: any) => (stops(j).position[6] = 0.99), /^stops\.position: runs from 0 to 1/],
      ['positions that do not rise strictly', (j: any) => (stops(j).position[2] = stops(j).position[1]), /^stops\.position\[2\]: rises strictly/],
      ['a weight above 1', (j: any) => (stops(j).weight[0] = 1.2), /^stops\.weight\[0\]: lies in \[0, 1\]/],
      ['a negative weight', (j: any) => (stops(j).weight[6] = -0.1), /^stops\.weight\[6\]: lies in \[0, 1\]/],
      ['weights that rise', (j: any) => (stops(j).weight[3] = 0.95), /^stops\.weight\[3\]: never rises/],
      ['lists of unequal length', (j: any) => stops(j).weight.pop(), /^stops: position and weight are as long as each other/],
      ['no stops', (j: any) => delete extensionAt(j, 'field.fallback').stops, /^stops: \{ position, weight \}/],
    ])('%s is refused, naming field.fallback', (_what, edit, complaint) => {
      refused(BASE, 'field.fallback', edit, complaint);
    });
  });

  describe('the blend graph: every pair of its nodes joined exactly once, the node tier core or deep per face', () => {
    const graph = (j: any) => extensionAt(j, 'field.graph');

    it.each([
      ['a pair joined twice', (j: any) => graph(j).edges.straight.push(['C', 'J']), /^edges\.straight\[8\]: joins C–J again/],
      ['a pair never joined', (j: any) => (graph(j).edges.straight = graph(j).edges.straight.filter(([a, b]: string[]) => !(a === 'J' && b === 'C'))), /^edges: C–J is never joined/],
      ['an edge to a node the graph does not name', (j: any) => graph(j).edges.straight.push(['J', 'X']), /^edges\.straight\[8\]: X is not a node of the graph/],
      ['an edge from a node to itself', (j: any) => graph(j).edges.waypoint.push(['R', 'R']), /^edges\.waypoint\[1\]: joins R to itself/],
      ['an edge that is not a pair', (j: any) => (graph(j).edges.restIntense = ['R0']), /^edges\.restIntense: an edge is a pair of node names/],
      ['a node tier other than core or deep', (j: any) => (graph(j).nodeTier.light = 'mid'), /^nodeTier\.light: core or deep/],
      ['a node tier for one face only', (j: any) => delete graph(j).nodeTier.dark, /^nodeTier: one tier per face/],
      ['no edges', (j: any) => delete graph(j).edges, /^edges: \{ straight, waypoint, restIntense \}/],
    ])('%s is refused, naming field.graph', (_what, edit, complaint) => {
      refused(BASE, 'field.graph', edit, complaint);
    });
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
