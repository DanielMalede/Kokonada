import { validatePlan } from '../../../../scripts/lab/capture.mjs';
import { app as LAB_APP } from '../../../../scripts/lab/capture-plans/v1-field.json';
import { QUIET_SLOTS } from '../../v2/field/fieldLaw';
import { PHONE, fallbackScenes, heroLayout } from '../../v2/field/fallbackScenes';
import type { FieldLayout, LayoutRect } from '../../v2/field/fieldDriver';
import { EXTENSIONS } from '../../v2/tokens/tokens.extensions.generated';
import { BASE } from '../../v2/tokens/tokens.generated';
import { FIELD_FACES, FIELD_SCENES, FIELD_TIERS, HERO_SCENES, fieldSceneCatalogue, fieldSceneLayout, type FieldSceneSpec } from '../fieldScenes';

// T14 (handoff items 7 and 9; the architect's T14 plan at c8ff246, forks F1–F6 at A): the Design Lab's field scenes. Abyss,
// both faces, the hero scenes rest, one.joy, three and one.intense at the tiers full, low and still (FieldView), and the
// fallback's scenes (FieldFallback mounted directly). The tier and the face come from the id, the taps are the hero's
// placements, and the period is the field's master period from the token, never a number written here (item 7).

type Placements = ReadonlyArray<{ readonly x: number; readonly y: number }>;
const EXT = EXTENSIONS as unknown as {
  base: { $root: { hero: { scenes: Record<string, { placements?: Placements }> } } };
  abyss: { $root: { hardest: never } };
};
const HERO = EXT.base.$root.hero.scenes;
const FALLBACK = fallbackScenes(HERO, EXT.abyss.$root.hardest);
const ALL = Object.values(FIELD_SCENES);
const FIELD = ALL.filter((s) => s.kind === 'field');
const FALLBACKS = ALL.filter((s) => s.kind === 'fallback');
const rect = (i: number): LayoutRect => ({ x: 10 * i, y: 10, width: 8, height: 8 });
const withRects = (n: number) => (w: number, h: number, fontScale: number): FieldLayout => ({
  ...heroLayout('abyss', w, h, fontScale),
  quietRects: Array.from({ length: n }, (_, i) => rect(i)),
});

describe('the catalogue: Abyss × {dark, light} × the hero scenes × {full, low, still}, and the fallback scenes', () => {
  it('names exactly the field scenes the plan asks for, the tier and the face in the id', () => {
    expect(FIELD_FACES).toEqual(['dark', 'light']);
    expect(HERO_SCENES).toEqual(['rest', 'one.joy', 'three', 'one.intense']);
    expect(FIELD_TIERS).toEqual(['full', 'low', 'still']);
    const expected = FIELD_FACES.flatMap((face) => HERO_SCENES.flatMap((scene) => FIELD_TIERS.map((tier) => `field.abyss.${face}.${scene}.${tier}`)));
    expect(FIELD.map((s) => s.id).sort()).toEqual([...expected].sort());
    for (const s of FIELD) {
      const [, direction, face, ...rest] = s.id.split('.');
      expect(s.direction).toBe(direction);
      expect(s.face).toBe(face);
      expect(s.tier).toBe(rest[rest.length - 1]);
      expect(s.hero).toBe(rest.slice(0, -1).join('.'));
    }
  });

  it('names the fallback scenes the designer ruled on (T13), on both faces, with no tier: the fallback has no motion', () => {
    const expected = FIELD_FACES.flatMap((face) => FALLBACK.map((f) => `fallback.abyss.${face}.${f.id}`));
    expect(FALLBACKS.map((s) => s.id).sort()).toEqual([...expected].sort());
    for (const s of FALLBACKS) {
      expect(s.id.split('.')[2]).toBe(s.face);
      expect(s.tier).toBeNull();
    }
  });

  it('every id is unique and a plain token the capture harness takes as a scene (its own plan validator)', () => {
    const ids = ALL.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(FIELD_SCENES).sort()).toEqual([...ids].sort());
    const plan = (scenes: string[]) => ({
      id: 'ids', app: LAB_APP, readyTimeoutMs: 30000, settleMs: 0,
      shots: scenes.map((scene, i) => ({ id: `s-${i}`, repeat: 1, scene, args: { clock: 'fixed', t: '0' }, device: { fontScale: 1, night: 'yes', animatorScale: 1, powerSave: false }, probes: ['stage'], expect: { direction: null, face: null, hero: null, tier: null } })),
    });
    expect(validatePlan(plan(ids))).toEqual([]);
    expect(validatePlan(plan(['field abyss'])).join()).toMatch(/scene must be a plain token/); // the check bites
  });

  it('a field scene\'s taps are its hero scene\'s placements, in order; a fallback scene\'s are the T13 scene\'s', () => {
    for (const s of FIELD) expect(s.taps).toEqual((HERO[s.hero!].placements ?? []).map((p) => ({ x: p.x, y: p.y })));
    expect(FIELD.find((s) => s.id === 'field.abyss.dark.three.full')!.taps).toHaveLength(3);
    for (const s of FALLBACKS) expect(s.taps).toEqual(FALLBACK.find((f) => `fallback.abyss.${s.face}.${f.id}` === s.id)!.taps);
  });
});

describe('the period is the field\'s master period, from the token (handoff item 7)', () => {
  it('every scene runs on BASE.field.clock.T', () => {
    for (const s of ALL) expect(s.periodMs).toBe(BASE.field.clock.T);
  });

  it('read from the token, not written as a number: a different T moves every scene with it', () => {
    jest.isolateModules(() => {
      jest.doMock('../../v2/tokens/tokens.generated', () => {
        const real = jest.requireActual('../../v2/tokens/tokens.generated');
        return { ...real, BASE: { ...real.BASE, field: { ...real.BASE.field, clock: { ...real.BASE.field.clock, T: 61234 } } } };
      });
      const moved = require('../fieldScenes') as typeof import('../fieldScenes');
      const periods = Object.values(moved.FIELD_SCENES).map((s) => s.periodMs);
      expect(periods.length).toBe(ALL.length);
      expect(new Set(periods)).toEqual(new Set([61234]));
    });
  });
});

describe('the layout: the hero\'s, with at most QUIET_SLOTS quiet rects (a RangeError, never a clamp)', () => {
  it('a scene\'s layout is the hero layout T13 assumes (UI-207), at the measured size and font scale', () => {
    for (const s of ALL) {
      expect(fieldSceneLayout(s, PHONE.width, PHONE.height, 1)).toEqual(heroLayout('abyss', PHONE.width, PHONE.height, 1));
      expect(fieldSceneLayout(s, 360, 740, 2)).toEqual(heroLayout('abyss', 360, 740, 2));
    }
  });

  const planted = (n: number): FieldSceneSpec => ({ ...FIELD[0], id: 'planted.seven', layout: withRects(n) });

  it('a planted scene with 7 quiet rects is a RangeError naming the scene, when the catalogue is built', () => {
    expect(QUIET_SLOTS).toBe(6);
    expect(() => fieldSceneCatalogue([planted(QUIET_SLOTS + 1)])).toThrow(RangeError);
    expect(() => fieldSceneCatalogue([planted(QUIET_SLOTS + 1)])).toThrow(/planted\.seven.*7 quiet rects.*at most 6/);
  });

  it('and when it is laid out at any size: a layout that grows past QUIET_SLOTS is never clamped', () => {
    expect(() => fieldSceneLayout(planted(QUIET_SLOTS + 1), 400, 800, 1)).toThrow(RangeError);
    expect(() => fieldSceneLayout(planted(QUIET_SLOTS + 1), 400, 800, 1)).toThrow(/planted\.seven/);
    expect(fieldSceneLayout(planted(QUIET_SLOTS), 400, 800, 1).quietRects).toHaveLength(QUIET_SLOTS);
    expect(fieldSceneCatalogue([planted(QUIET_SLOTS)])['planted.seven'].id).toBe('planted.seven');
  });

  it('a repeated id is refused by name', () => {
    expect(() => fieldSceneCatalogue([FIELD[0], FIELD[0]])).toThrow(new RegExp(FIELD[0].id.replace(/\./g, '\\.')));
  });
});
