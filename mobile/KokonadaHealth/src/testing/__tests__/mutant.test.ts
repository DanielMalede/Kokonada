/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { loadMutant } from '../mutant';
import { APP_ROOT } from '../guards/productionImports';
import { clampToDisc } from '../../state/hot/laneCommit';
import { colors } from '../../design/tokens';

// D8 rule 2: a planted mutant of production code is built in memory, never written under src/. The
// loader reads the real file, applies exact find/replace mutations (each must match exactly once, so
// a control can never silently plant nothing), compiles it with the app's own babel config, and runs
// it with a require that resolves its relative imports to the ORIGINAL modules in this registry.

const LANE = path.join(APP_ROOT, 'src/state/hot/laneCommit.ts');
const THEME = path.join(APP_ROOT, 'src/design/theme.ts');

describe('loadMutant', () => {
  it('with no mutation, the copy behaves exactly as the original', () => {
    const copy = loadMutant<typeof import('../../state/hot/laneCommit')>(LANE, [], require);
    for (const p of [{ x: 3, y: 4 }, { x: 0.2, y: -0.1 }, { x: NaN, y: 1 }]) expect(copy.clampToDisc(p)).toEqual(clampToDisc(p));
  });

  it('a mutation changes behaviour (the clamp to the unit disc removed)', () => {
    const mutant = loadMutant<typeof import('../../state/hot/laneCommit')>(LANE, [
      { find: 'if (r <= 1) return { x, y };', replace: 'return { x, y };' },
    ], require);
    expect(clampToDisc({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(mutant.clampToDisc({ x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it('refuses a mutation that matches nothing, or more than once', () => {
    expect(() => loadMutant(LANE, [{ find: 'this text is not in the file', replace: '' }], require)).toThrow(/matches 0 times/);
    expect(() => loadMutant(LANE, [{ find: 'const', replace: 'let' }], require)).toThrow(/matches \d+ times/);
  });

  it('resolves relative imports to the original modules (one registry, one instance)', () => {
    const mutant = loadMutant<typeof import('../../design/theme')>(THEME, [], require);
    expect(mutant.resolveScheme('light')).toBe(colors.light); // the same tokens object, not a copy
  });

  it('writes nothing to disk', () => {
    const dir = path.dirname(LANE);
    const before = fs.readdirSync(dir).sort();
    loadMutant(LANE, [{ find: 'if (r <= 1) return { x, y };', replace: 'return { x, y };' }], require);
    expect(fs.readdirSync(dir).sort()).toEqual(before);
  });
});
