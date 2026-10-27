import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTokenModel, generateExtensionsModule, generateTokensModule } from '../lib/emit.mjs';
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
  // list then fails to type-check against it. Each of the 10 shadow tokens per direction is typed
  // (the two-direction case: the temp-folder fixture below).
  it('types every shadow list, including the empty and the one-line ones', () => {
    expect(generateTokensModule(real()).match(/ as ShadowLayer\[\]/g)).toHaveLength(10);
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

// The architect's seam (v1lab-r1-reconciliation): the $extensions data (hero, scenes, hardest
// placements, graph tables) lives in its own module, which only the lab, scripts and tests import.
describe('generateExtensionsModule', () => {
  it('holds EXTENSIONS, which the token module no longer carries', () => {
    expect(generateTokensModule(real())).not.toMatch(/EXTENSIONS/);
    expect(generateExtensionsModule(real())).toMatch(/^export const EXTENSIONS = /m);
  });

  it('is byte-deterministic, LF only, and records the sha256 of each source', () => {
    const text = generateExtensionsModule(real());
    expect(generateExtensionsModule([...real()].reverse())).toBe(text);
    expect(text.includes('\r')).toBe(false);
    expect(text).toMatch(/^export const EXTENSIONS_SOURCE = /m);
    for (const source of real()) {
      expect(text).toContain(`'${source.name}': '${crypto.createHash('sha256').update(source.bytes).digest('hex')}'`);
    }
  });
});

describe('buildTokenModel', () => {
  // The model is plain data from a .mjs module, so TypeScript cannot see its shape.
  const model: any = buildTokenModel(real());

  it('names the directions after their files', () => {
    expect(Object.keys(model.directions)).toEqual(['abyss']);
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
    // Abyss dark text.onTint -> ground; text.onInk -> text.onTint -> ground.
    const abyssDark = model.directions.abyss.color.dark;
    expect(abyssDark.text.onTint).toEqual(abyssDark.ground);
    expect(abyssDark.text.onInk).toEqual(abyssDark.ground);
  });

  it('reads dimensions as dp and durations as ms', () => {
    expect(model.base.cta.height).toBe(56);
    expect(model.base.field.clock.T).toBe(60000);
    expect(model.directions.abyss.plate.depth).toBe(0);
  });

  it('keeps an empty shadow list empty', () => {
    expect(model.directions.abyss.elevation.e2.light).toEqual([]);
  });

  // Designer B2 review §4 and §5.
  it('carries the noise rule, the title and display sizes, and no per-direction label band', () => {
    expect(model.base.field.noise).toEqual({ space: 'oklab.L', paintDither: 0 });
    expect(model.base.type.ui.title).toEqual({
      latin: { size: 20, lineHeight: 28, tracking: -0.005 },
      hebrew: { size: 20, lineHeight: 30, tracking: 0 },
    });
    expect(model.base.type.ui.display).toEqual({
      latin: { size: 28, lineHeight: 34, tracking: -0.01 },
      hebrew: { size: 28, lineHeight: 36, tracking: 0 },
    });
    for (const id of Object.keys(model.directions)) expect(model.directions[id].plate.labelBand).toBeUndefined();
    expect(model.base.plate.labelBand.min).toBe(28);
  });

  // DSN-035 (designer rulings §2): the limit is counted in breath steps, and n is an integer from JS.
  it('carries the breath change limit in steps, and the breath-phase formula with n from JS', () => {
    expect(model.base.breath.changeLimit).toEqual({ slowerStepsPerWrap: 1, fasterWrapsPerStep: 2 });
    expect(model.extensions.base['field.clock'].breathPhase).toBe(
      'frac(n·t/T) at fixed n; n(s) = nRest − Math.round((nRest − nStress)·s), computed in JS, passed as an integer',
    );
  });

  it('defines the haptic delay as Android’s gap after the previous primitive ends', () => {
    expect(model.extensions.base.haptics.delay).toMatch(/addPrimitive.*after the previous primitive ends/);
  });

  it('collects the $extensions data by path, without locks or hex markers', () => {
    expect(model.extensions.base.$root.hero.elements).toEqual(expect.arrayContaining(['hero.header', 'hero.scroll']));
    expect(model.extensions.base.neverRed).toEqual({ status: 'decided', rule: 'red iff hue in [start,end] inclusive and C >= floor' });
    expect(model.extensions.abyss['haptics.place']).toEqual({ fallback: 'EFFECT_TICK', trigger: 'plate.tap' });
    expect(JSON.stringify(model.extensions)).not.toMatch(/"lock"|"hex":"(generated|v0)"/);
  });
});

// The close-out leaves one shipped direction, so the generator's handling of several is shown on a
// fixture direction in a temp folder, never in design-tokens/: a copy of Abyss with a negative plate
// depth, an inset shadow layer and a three-step alias chain, read, checked and rendered beside Abyss.
describe('N directions: a fixture direction in a temp folder', () => {
  const CLI = path.resolve(__dirname, '../generate.mjs');
  const APP_ROOT = path.resolve(__dirname, '../../..');
  let dir = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-n-'));
    for (const name of fs.readdirSync(DESIGN_TOKENS)) fs.copyFileSync(path.join(DESIGN_TOKENS, name), path.join(dir, name));
    const json = JSON.parse(fs.readFileSync(path.join(DESIGN_TOKENS, 'direction.abyss.tokens.json'), 'utf8'));
    json.plate.depth.$value = -8;
    json.elevation.recessed.dark.$value = [{
      color: { colorSpace: 'oklch', components: [0, 0, 0], alpha: 0.55, hex: '#000000' },
      offsetX: { value: 0, unit: 'px' }, offsetY: { value: 4, unit: 'px' }, blur: { value: 12, unit: 'px' }, spread: { value: 0, unit: 'px' }, inset: true,
    }];
    json.elevation.recessed.dark.$extensions = { 'com.kokonada': { hex: 'generated' } };
    json.color.dark.nav.activeLabel.$value = '{color.dark.text.onInk}';
    fs.writeFileSync(path.join(dir, 'direction.planted.tokens.json'), JSON.stringify(json, null, 2) + '\n');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads, checks and models both directions, named after their files', () => {
    const m: any = buildTokenModel(readTokenSources(dir));
    expect(Object.keys(m.directions)).toEqual(['abyss', 'planted']);
    expect(m.directions.abyss).toEqual((buildTokenModel(real()) as any).directions.abyss);
    expect(m.directions.planted.plate.depth).toBe(-8);
  });

  it('keeps shadow layers as plain numbers and colours', () => {
    const m: any = buildTokenModel(readTokenSources(dir));
    expect(m.directions.planted.elevation.recessed.dark).toEqual([
      expect.objectContaining({ offsetX: 0, offsetY: 4, blur: 12, spread: 0, inset: true, color: expect.objectContaining({ hex: '#000000', alpha: 0.55 }) }),
    ]);
  });

  it('resolves a three-step alias chain: nav.activeLabel -> text.onInk -> text.onTint -> ground', () => {
    const dark = (buildTokenModel(readTokenSources(dir)) as any).directions.planted.color.dark;
    expect(dark.nav.activeLabel).toEqual(dark.ground);
  });

  it('renders both, typing every shadow list in each, and the CLI writes them', () => {
    const text = generateTokensModule(readTokenSources(dir));
    expect(text).toMatch(/^export type DirectionId = 'abyss' \| 'planted';$/m);
    expect(text).toMatch(/^const planted: DirectionTokens = /m);
    expect(text.match(/ as ShadowLayer\[\]/g)).toHaveLength(20);
    const out = path.join(dir, 'out.ts');
    const r = spawnSync(process.execPath, [CLI, '--sources', dir, '--out', out], { cwd: APP_ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(out, 'utf8')).toBe(text);
  });
});
