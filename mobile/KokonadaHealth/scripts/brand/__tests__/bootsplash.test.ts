import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BREATH_OPACITY } from '../../../src/experience/aura/breath';

// The bootsplash is the FIRST frame of the brand — the OS draws it before React mounts. These
// read the REAL on-disk native files (not a mock): the splash must fill with the abyss (#060B11)
// and the source logo must be the Aurora Seed with its bloom baked at the breath's REST opacity,
// so the OS still-frame hands off to the RN Splash's breath with no jump.

const ROOT = path.resolve(__dirname, '../../..'); // mobile/KokonadaHealth
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('bootsplash — the abyss still-frame', () => {
  it('fills the OS splash with the abyss background #060B11 (not the old placeholder)', () => {
    const colors = read('android/app/src/main/res/values/colors.xml');
    expect(colors).toMatch(/<color name="bootsplash_background">#060B11<\/color>/i);
  });

  it('the source logo is the Aurora Seed with its bloom baked at the breath REST opacity', () => {
    const svg = read('assets/bootsplash/logo.svg');
    expect(svg).toContain('radialGradient'); // it is the bloom mark, not the old "K" glyph
    expect(svg).toContain(`stop-opacity="${BREATH_OPACITY.rest}"`); // baked at rest (the seam)
    expect(svg).not.toContain('>K<'); // the old placeholder text glyph is gone
  });
});
