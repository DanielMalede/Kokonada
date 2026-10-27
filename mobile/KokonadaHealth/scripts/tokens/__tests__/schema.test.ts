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
