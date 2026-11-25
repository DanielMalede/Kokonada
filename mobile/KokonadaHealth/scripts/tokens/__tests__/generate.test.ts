import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { RUNTIME_STATICS, buildTokenModel, generateExtensionsModule, generateStaticsModule, generateTokensModule } from '../lib/emit.mjs';
import { readTokenSources } from '../lib/sources.mjs';
import { oklchToOklab } from '../../../src/design/v2/color/oklab.ts';

// The generator has no dependencies: it reads design-tokens/*.tokens.json, checks them against
// the schema, resolves aliases, adds OKLab to every colour, and renders one TypeScript module.

const DESIGN_TOKENS = path.resolve(__dirname, '../../../../../design-tokens');
type Source = { name: string; bytes: Buffer; json: any };
const real = (): Source[] => readTokenSources(DESIGN_TOKENS);

/**
 * The line a source's hash takes: keyed by the file name without .tokens.json, `base` bare and
 * `'direction.abyss'` quoted. A key holding "token" made each line a gitleaks finding (UI-104).
 */
function hashLine(source: Source): string {
  const stem = source.name.replace(/\.tokens\.json$/, '');
  const hash = crypto.createHash('sha256').update(source.bytes).digest('hex');
  return `  ${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(stem) ? stem : `'${stem}'`}: '${hash}',`;
}

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

  it('embeds the sha256 of each source file’s raw bytes, keyed by the file’s stem', () => {
    const text = generateTokensModule(real());
    for (const source of real()) {
      expect(text).toContain(hashLine(source));
      expect(text).not.toContain(`'${source.name}'`);
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
      expect(text).toContain(hashLine(source));
      expect(text).not.toContain(`'${source.name}'`);
    }
  });
});

// DEC-172 (the architect's Fork 1, task 1D): the field's runtime statics (the rest lobes, the drift tables, the
// fallback stops, the graph's edges and node tier), by a pinned allow-list, in a third module that app code and
// worklets may read. G1's allow-list half, G2 and G6 here; G3 in freshness.test.ts; G4 in schema.test.ts.
describe('generateStaticsModule (DEC-172)', () => {
  /** The `com.kokonada` extension data of the group at `groupPath` in a source file's JSON. */
  const extensionAt = (json: any, groupPath: string) => groupPath.split('.').reduce((node, k) => node[k], json).$extensions['com.kokonada'];
  const sourceJson = (name: string) => real().find((s) => s.name === name)!.json;

  it('G1: the allow-list is a pinned, frozen literal: the five keys the designer acknowledged', () => {
    expect(RUNTIME_STATICS).toEqual([
      { scope: 'base', path: 'field.graph', key: 'nodeTier' },
      { scope: 'base', path: 'field.graph', key: 'edges' },
      { scope: 'base', path: 'field.clock', key: 'drift' },
      { scope: 'base', path: 'field.fallback', key: 'stops' },
      { scope: 'direction', path: 'field.rest', key: 'lobes' },
    ]);
    expect(Object.isFrozen(RUNTIME_STATICS)).toBe(true);
    expect(RUNTIME_STATICS.every((entry: object) => Object.isFrozen(entry))).toBe(true);
  });

  it('G1: STATICS holds exactly the allow-listed keys, for base and every direction, each with its source’s value', () => {
    const model: any = buildTokenModel(real());
    const held = Object.entries(model.statics).flatMap(([scope, groups]: [string, any]) =>
      Object.entries(groups).flatMap(([group, keys]: [string, any]) => Object.keys(keys).map((key) => `${scope} ${group} ${key}`)),
    );
    expect(held.sort()).toEqual([
      'abyss field.rest lobes',
      'base field.clock drift',
      'base field.fallback stops',
      'base field.graph edges',
      'base field.graph nodeTier',
    ]);
    for (const { scope, path: group, key } of RUNTIME_STATICS as Array<{ scope: string; path: string; key: string }>) {
      const [id, file] = scope === 'base' ? ['base', 'base.tokens.json'] : ['abyss', 'direction.abyss.tokens.json'];
      expect(model.statics[id][group][key]).toEqual(extensionAt(sourceJson(file), group)[key]);
    }
  });

  it('G2: is byte-deterministic whatever the read order, LF only, and records the sha256 of each source by its stem', () => {
    const text = generateStaticsModule(real());
    expect(generateStaticsModule([...real()].reverse())).toBe(text);
    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toMatch(/^\/\/ GENERATED by scripts\/tokens\/generate\.mjs from design-tokens\/\*\.tokens\.json\. Do not edit\./);
    expect(text).toMatch(/^export const STATICS_SOURCE = /m);
    for (const source of real()) {
      expect(text).toContain(hashLine(source));
      expect(text).not.toContain(`'${source.name}'`);
    }
  });

  it('G6: imports nothing, and exports only STATICS_SOURCE and STATICS, the latter deeply read-only (as const)', () => {
    const text = generateStaticsModule(real());
    expect(text).not.toMatch(/^\s*import\b|\brequire\s*\(|\bfunction\b|=>/m);
    expect([...text.matchAll(/^export\s+(?:const|let|var|function|class|type|interface|default|enum)\s*([A-Za-z_$][\w$]*)?/gm)].map((m) => m[1])).toEqual([
      'STATICS_SOURCE',
      'STATICS',
    ]);
    expect(text).toMatch(/^} as const;$/m);
    expect(generateTokensModule(real())).not.toMatch(/STATICS/);
  });

  it('refuses sources whose statics fail the schema, naming the path', () => {
    const broken = real().map((s) => {
      if (s.name !== 'base.tokens.json') return s;
      const json = structuredClone(s.json);
      extensionAt(json, 'field.clock').drift.harmonics.lobe1 = [3, 2.5];
      return { ...s, json };
    });
    expect(() => generateStaticsModule(broken)).toThrow(/base\.tokens\.json: field\.clock: /);
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

// The F1 token gaps (the designer's ledger §5.9 and F10's "Token gaps", 2026-11-23). Sizes, targets and
// timings every direction shares are in base, beside cta.height and nav.iconSize; keylines, the pager's
// dots and the radii that alias the direction's own radius scale are in the direction, beside cta.keyline
// and nav.active.dot; every colour role is under color.<face>, as an alias wherever the ledger names a role.
describe('buildTokenModel: the F1 gaps', () => {
  const model: any = buildTokenModel(real());
  const abyss = model.directions.abyss;

  it('base holds the shared sizes, the focus ring, the content width and the components’ geometry', () => {
    expect(model.base.target).toEqual({ min: 48 });
    expect(model.base.row).toEqual({ min: 56, twoLine: 72 });
    expect(model.base.icon).toEqual({ xs: 16, s: 20, m: 24, stroke: 1.5 });
    expect(model.base.focus).toEqual({ width: 2, offset: 2 });
    expect(model.base.content).toEqual({ maxWidth: 560 });
    expect(model.base.pager).toEqual({ row: 48 });
    expect(model.base.brand).toEqual({ mark: { splash: 128, page: 80 } });
    expect(model.base.input).toEqual({ field: { minHeight: 56 } });
    expect(model.base.toggle).toEqual({ width: 52, height: 32, thumb: 24 });
    expect(model.base.slider).toEqual({ track: 4, thumb: 24, hit: 48 });
    expect(model.base.skeleton).toEqual({ motion: 'static' });
  });

  it('motion.press is 100 ms on the respond curve and none under reduced motion; progress shows after 400 ms', () => {
    expect(model.base.motion.press).toEqual({ duration: 100, easing: [0.22, 1, 0.36, 1], reducedMotion: 'none' });
    expect(model.base.motion.press.easing).toEqual(model.base.motion.respond.easing);
    expect(model.base.feedback).toEqual({ progressDelay: 400 });
  });

  it('Abyss holds the keylines, the radii from its own scale, the notice, the pager’s dots and the field', () => {
    expect(abyss.button).toEqual({ keyline: 1.5 });
    expect(abyss.sheet).toEqual({ radius: 28 });
    expect(abyss.dialog).toEqual({ radius: 20 });
    expect(abyss.notice).toEqual({ border: 1, radius: 14, padding: { horizontal: 16, vertical: 12 }, iconGap: 12 });
    expect(abyss.pager).toEqual({ dot: 6, activeWidth: 16, gap: 8 });
    expect(abyss.input).toEqual({ field: { keyline: 1.5, radius: 14 } });
    expect([abyss.sheet.radius, abyss.dialog.radius, abyss.notice.radius, abyss.input.field.radius]).toEqual([
      abyss.radius.xl,
      abyss.radius.l,
      abyss.radius.m,
      abyss.radius.m,
    ]);
  });

  it.each(['dark', 'light'])('Abyss %s: each new colour role is the token the ledger names', (face) => {
    const c = abyss.color[face];
    expect(c.focus).toEqual(c.text.primary);
    expect(c.notice).toEqual({ surface: face === 'dark' ? c.surface2 : c.surface1, border: c.line.hairline });
    expect(c.button).toEqual({ keyline: c.line.control });
    expect(c.input).toEqual({ fill: c.surface1, keyline: c.line.control });
    expect(c.skeleton).toEqual({ fill: c.surface1 });
  });

  it.each(['dark', 'light'])('Abyss %s: the scrim is the ground at α 0.72', (face) => {
    const c = abyss.color[face];
    expect(c.scrim).toEqual({ ...c.ground, alpha: 0.72 });
  });

  // Aliases, not copies: each follows its source when the source changes.
  it('bites: the radii, the press curve and the colour roles follow a planted change to their source', () => {
    const planted = real().map((s) => {
      const json = structuredClone(s.json);
      if (s.name === 'base.tokens.json') json.motion.respond.easing.$value = [0.3, 1, 0.4, 1];
      if (s.name === 'direction.abyss.tokens.json') {
        json.radius.xl.$value.value = 30;
        json.radius.m.$value.value = 12;
        json.color.dark.surface2.$value = '{color.dark.ground}';
        json.color.light.line.control.$value = '{color.light.text.secondary}';
      }
      return { ...s, json };
    });
    const m: any = buildTokenModel(planted);
    expect(m.base.motion.press.easing).toEqual([0.3, 1, 0.4, 1]);
    expect([m.directions.abyss.sheet.radius, m.directions.abyss.notice.radius, m.directions.abyss.input.field.radius]).toEqual([30, 12, 12]);
    expect(m.directions.abyss.color.dark.notice.surface).toEqual(m.directions.abyss.color.dark.ground);
    expect(m.directions.abyss.color.light.button.keyline).toEqual(m.directions.abyss.color.light.text.secondary);
    expect(m.directions.abyss.color.light.input.keyline).toEqual(m.directions.abyss.color.light.text.secondary);
  });
});

// The designer's G8 rulings on the hero lanes (2026-11-25): the ledger additions this lane owns. F2: the capture
// harness finds the hero's parts by these element IDs.
describe('buildTokenModel: the G8 ledger additions (the designer, 2026-11-25)', () => {
  const model: any = buildTokenModel(real());
  const elements: string[] = model.extensions.base.$root.hero.elements;

  it('F2: the hero elements name the CTA and its label, the live beads oldest first with their settings, the leaving bead, PlateTouch, the latest bead’s node and PlateEntry, each once', () => {
    expect(new Set(elements).size).toBe(elements.length);
    expect(elements.slice(elements.indexOf('hero.cta'), elements.indexOf('hero.cta') + 2)).toEqual(['hero.cta', 'hero.cta.label']);
    expect(elements.slice(elements.indexOf('hero.plate.bead.0'), elements.indexOf('hero.listEntry') + 1)).toEqual([
      'hero.plate.bead.0',
      'hero.plate.bead.0.setting',
      'hero.plate.bead.0.halo',
      'hero.plate.bead.1',
      'hero.plate.bead.1.setting',
      'hero.plate.bead.1.halo',
      'hero.plate.bead.2',
      'hero.plate.bead.2.setting',
      'hero.plate.bead.2.halo',
      'hero.plate.bead.leaving',
      'hero.plate.touch',
      'hero.plate.bead.latest.a11y',
      'hero.listEntry',
    ]);
  });

  // LEDGER rev §3 L9 and §5.9, F3: a Well that hosts a Button changes state at most once per well.hold; a Well that
  // hosts CommitCTA keeps DEC-174's limits. A timing every direction shares, so in base, beside the Well's heights.
  it('L9 (F3): well.hold is 400 ms, beside the Well’s heights, and its rule names the Button host only', () => {
    expect(model.base.well).toEqual({ height: 56, consentSlotHeight: 108, hold: 400 });
    expect(model.extensions.base['well.hold']).toEqual({
      rule: 'a non-commit Well (one that hosts a Button) changes state at most once per well.hold; a Well that hosts CommitCTA keeps the limits DEC-174 sets',
    });
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

  it('holds each direction’s rest lobes in the statics, and the CLI writes the statics module beside --out', () => {
    const sources = readTokenSources(dir);
    const m: any = buildTokenModel(sources);
    expect(Object.keys(m.statics)).toEqual(['base', 'abyss', 'planted']);
    expect(m.statics.planted).toEqual(m.statics.abyss);
    const out = path.join(dir, 'statics-out', 'tokens.generated.ts');
    const r = spawnSync(process.execPath, [CLI, '--sources', dir, '--out', out], { cwd: APP_ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(path.dirname(out), 'tokens.statics.generated.ts'), 'utf8')).toBe(generateStaticsModule(sources));
  });
});
