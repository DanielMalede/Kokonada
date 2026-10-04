import crypto from 'node:crypto';
import path from 'node:path';
import { buildTokenModel, generateTokensModule } from '../lib/emit.mjs';
import { readTokenSources } from '../lib/sources.mjs';
import { oklchToOklab } from '../../../src/design/v2/color/oklab.ts';

// The generator has no dependencies: it reads design-tokens/*.tokens.json, checks them against
// the schema, resolves aliases, adds OKLab to every colour, and renders one TypeScript module.

const DESIGN_TOKENS = path.resolve(__dirname, '../../../../../design-tokens');
type Source = { name: string; bytes: Buffer; json: any };
const real = (): Source[] => readTokenSources(DESIGN_TOKENS);

describe('generateTokensModule', () => {
  it('is byte-deterministic, and does not depend on the order the files are read in', () => {
    const first = generateTokensModule(real());
    expect(generateTokensModule(real())).toBe(first);
    expect(generateTokensModule([...real()].reverse())).toBe(first);
  });

  it('writes LF line endings and ends with a newline', () => {
    const text = generateTokensModule(real());
    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('embeds the sha256 of each source file’s raw bytes', () => {
    const text = generateTokensModule(real());
    for (const source of real()) {
      const hash = crypto.createHash('sha256').update(source.bytes).digest('hex');
      expect(text).toContain(`'${source.name}': '${hash}'`);
    }
  });

  it('changes when a single byte of a source changes', () => {
    const sources = real();
    const edited = sources.map((s) =>
      s.name === 'base.tokens.json' ? { ...s, bytes: Buffer.concat([s.bytes, Buffer.from('\n')]) } : s,
    );
    expect(generateTokensModule(edited)).not.toBe(generateTokensModule(sources));
  });

  // An empty shadow list rendered bare is inferred never[], and the next direction's non-empty
  // list then fails to type-check against it. Each of the 10 shadow tokens per direction is typed.
  it('types every shadow list, including the empty and the one-line ones', () => {
    expect(generateTokensModule(real()).match(/ as ShadowLayer\[\]/g)).toHaveLength(30);
  });

  it('refuses sources that fail the schema, and lists the errors', () => {
    const broken = real().map((s) => {
      if (s.name !== 'direction.abyss.tokens.json') return s;
      const json = structuredClone(s.json);
      json.plate.inset.$value.unit = 'rem';
      return { ...s, json };
    });
    expect(() => generateTokensModule(broken)).toThrow(/direction\.abyss\.tokens\.json: plate\.inset: /);
  });
});

describe('buildTokenModel', () => {
  // The model is plain data from a .mjs module, so TypeScript cannot see its shape.
  const model: any = buildTokenModel(real());

  it('names the directions after their files', () => {
    expect(Object.keys(model.directions)).toEqual(['abyss', 'basin', 'linen']);
  });

  it('gives every colour its hex, alpha, OKLCh components and OKLab from the colour core', () => {
    const ground = model.directions.abyss.color.dark.ground;
    const lab = oklchToOklab({ L: 0.15, C: 0.025, h: 240 });
    expect(ground.hex).toBe('#030C15');
    expect(ground.alpha).toBe(1);
    expect(ground.oklch).toEqual([0.15, 0.025, 240]);
    expect(ground.oklab[0]).toBeCloseTo(lab.L, 10);
    expect(ground.oklab[1]).toBeCloseTo(lab.a, 10);
    expect(ground.oklab[2]).toBeCloseTo(lab.b, 10);
  });

  it('resolves aliases to the value they point at, through chains', () => {
    const linenDark = model.directions.linen.color.dark;
    expect(linenDark.text.onTint).toEqual(linenDark.ground);
    // nav.activeLabel -> text.onInk -> ground
    expect(linenDark.nav.activeLabel).toEqual(linenDark.ground);
  });

  it('reads dimensions as dp and durations as ms', () => {
    expect(model.base.cta.height).toBe(56);
    expect(model.base.field.clock.T).toBe(60000);
    expect(model.directions.basin.plate.depth).toBe(-8);
  });

  it('keeps shadow layers as plain numbers and colours', () => {
    expect(model.directions.basin.elevation.recessed.dark).toEqual([
      expect.objectContaining({ offsetX: 0, offsetY: 4, blur: 12, spread: 0, inset: true, color: expect.objectContaining({ hex: '#000000', alpha: 0.55 }) }),
    ]);
    expect(model.directions.abyss.elevation.e2.light).toEqual([]);
  });

  it('collects the $extensions data by path, without locks or hex markers', () => {
    expect(model.extensions.base.$root.hero.elements).toEqual(expect.arrayContaining(['hero.header', 'hero.scroll']));
    expect(model.extensions.base.neverRed).toEqual({ status: 'decided', rule: 'red iff hue in [start,end] inclusive and C >= floor' });
    expect(model.extensions.abyss['haptics.place']).toEqual({ fallback: 'EFFECT_TICK', trigger: 'plate.tap' });
    expect(JSON.stringify(model.extensions)).not.toMatch(/"lock"|"hex":"(generated|v0)"/);
  });
});
