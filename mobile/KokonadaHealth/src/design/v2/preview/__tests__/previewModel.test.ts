import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE } from '../../tokens/tokens.generated.ts';
import { ADMISSION } from '../../field/placementLedger.ts';
import { cycle, PREVIEW_SCENES, PREVIEW_TIERS, previewLayout, sceneTaps, tapOnDisc, withTap, type HeroScenes } from '../previewModel.ts';

// The dev-only field preview's pure parts: the scenes and tiers it cycles through, the layout it measures
// for FieldView (the plate centred, at most the token's diameter, inside the view), and a tap on the view
// turned into a placement on the unit disc, y up, the cold lane's last three kept.

const SCENES = (EXTENSIONS as unknown as { base: { $root: { hero: { scenes: HeroScenes } } } }).base.$root.hero.scenes;

describe('what the preview cycles through', () => {
  it('the scenes are rest, one.joy and three, each a hero scene in the tokens', () => {
    expect(PREVIEW_SCENES).toEqual(['rest', 'one.joy', 'three']);
    for (const s of PREVIEW_SCENES) expect(SCENES[s].placements).toBeDefined();
  });

  it('the tiers are full, low and still', () => {
    expect(PREVIEW_TIERS).toEqual(['full', 'low', 'still']);
  });

  it('cycle steps to the next and wraps; an unknown value starts at the first', () => {
    expect(cycle(PREVIEW_SCENES, 'rest')).toBe('one.joy');
    expect(cycle(PREVIEW_SCENES, 'three')).toBe('rest');
    expect(cycle(PREVIEW_TIERS, 'nope' as never)).toBe('full');
  });
});

describe('a scene as taps', () => {
  it('rest has none; one.joy is its J bead; three its three beads, in order', () => {
    expect(sceneTaps(SCENES, 'rest')).toEqual([]);
    expect(sceneTaps(SCENES, 'one.joy')).toEqual([{ x: 0.566, y: 0.566 }]);
    expect(sceneTaps(SCENES, 'three')).toEqual([{ x: 0.566, y: 0.566 }, { x: 0.566, y: -0.566 }, { x: -0.566, y: -0.566 }]);
  });

  it('an unknown scene has no taps', () => {
    expect(sceneTaps(SCENES, 'none')).toEqual([]);
  });
});

describe('the layout handed to FieldView', () => {
  it('the plate is centred, at the token diameter when the view is wide enough', () => {
    expect(previewLayout(411, 800, 1.3)).toEqual({ width: 411, height: 800, centre: [205.5, 400], radius: BASE.plate.maxDiameter / 2, fontScale: 1.3 });
  });

  it('a narrow view shrinks the plate to fit its shorter side', () => {
    expect(previewLayout(300, 500, 1).radius).toBe(150);
    expect(previewLayout(600, 200, 1).radius).toBe(100);
  });
});

describe('a tap on the view as a placement', () => {
  const layout = previewLayout(400, 800, 1);
  const R = layout.radius;

  it('the plate centre is 0, 0; right and up are positive (y up)', () => {
    expect(tapOnDisc({ x: 200, y: 400 }, layout)).toEqual({ x: 0, y: 0 });
    expect(tapOnDisc({ x: 200 + R / 2, y: 400 - R / 2 }, layout)).toEqual({ x: 0.5, y: 0.5 });
    expect(tapOnDisc({ x: 200 - R / 4, y: 400 + R / 2 }, layout)).toEqual({ x: -0.25, y: -0.5 });
  });

  it('a tap outside the plate lands on its rim, in the same direction', () => {
    const t = tapOnDisc({ x: 200 + 3 * R, y: 400 - 4 * R }, layout);
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(1, 12);
    expect(t.x).toBeCloseTo(0.6, 12);
    expect(t.y).toBeCloseTo(0.8, 12);
  });

  it('withTap appends and keeps the last ADMISSION.live (the cold lane\'s three), never mutating', () => {
    const a = { x: 0.1, y: 0 };
    const b = { x: 0.2, y: 0 };
    const c = { x: 0.3, y: 0 };
    const d = { x: 0.4, y: 0 };
    const three = [a, b, c];
    expect(ADMISSION.live).toBe(3);
    expect(withTap(three, d)).toEqual([b, c, d]);
    expect(three).toEqual([a, b, c]);
    expect(withTap([], a)).toEqual([a]);
  });
});
