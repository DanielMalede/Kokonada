/// <reference types="node" />
import * as path from 'path';
import ts from 'typescript';
import { pinFailures, isProductionPath, scanPinnedExports, type PinScan } from '../guards/pinnedCallers';
import { APP_ROOT, productionFiles } from '../guards/productionImports';
import { loadTsConfig } from '../guards/tsProgram';

// QA-116's guard (Stage 0 Q1b): a callable production export that a test imports must have a production
// caller, unless the dead list names it. Every planted source below is an in-memory overlay read by the
// TypeScript program; nothing is written under src (D8).

const TIMEOUT = 60_000;
const at = (rel: string) => path.join(APP_ROOT, rel);
const parsed = loadTsConfig();

// The planted files sit in directories that exist: TypeScript does not probe for a module file in a
// directory the host reports missing, and the overlay supplies files, not directories.
const MODULE = 'src/plantedQa116Module.ts';
const BARREL = 'src/plantedQa116Barrel.ts';
const CALLER = 'src/plantedQa116Caller.tsx';
const TEST = 'src/__tests__/plantedQa116.test.ts';
const DEFAULT_ONLY = 'src/plantedQa116Default.ts';
const ORPHAN = 'src/plantedQa116Orphan.ts';
const LAB = 'src/design/lab/plantedQa116Lab.tsx';
const BIOAURA = 'src/experience/aura/BioAura.tsx';
const APP = 'App.tsx';

const planted: Record<string, string> = {
  // The release entry reaches the planted caller (and through it the default-export file), so those are
  // in the release closure; ORPHAN and LAB are not.
  [at(APP)]: `${ts.sys.readFile(at(APP))!}\nimport './src/plantedQa116Caller';\n`,
  [at(DEFAULT_ONLY)]: [
    "import { plantedDefaultReexported } from './plantedQa116Module';",
    'export default plantedDefaultReexported;',
  ].join('\n'),
  [at(ORPHAN)]: [
    "import { plantedOrphanCalled } from './plantedQa116Module';",
    'export const plantedOrphanValue = plantedOrphanCalled();',
  ].join('\n'),
  [at(LAB)]: [
    "import { plantedLabOnly } from '../../plantedQa116Module';",
    'export const plantedLabValue = plantedLabOnly();',
  ].join('\n'),
  [at(MODULE)]: [
    'export function plantedDefaultReexported(): number { return 10; }',
    'export function plantedTypeImported(): number { return 11; }',
    'export function plantedTypeSpecifier(): number { return 12; }',
    'export class PlantedClass { readonly v = 13; }',
    'export class PlantedBuilt { readonly v = 14; }',
    'export function plantedOverloaded(n: number): number;',
    'export function plantedOverloaded(n: string): number;',
    "export function plantedOverloaded(n: number | string): number { return typeof n === 'number' && n > 0 ? plantedOverloaded(n - 1) : 0; }",
    'export function plantedDestructured(): number { return 15; }',
    'export function plantedRequirePinned(): number { return 16; }',
    'export function plantedActualPinned(): number { return 17; }',
    'export function plantedOrphanCalled(): number { return 18; }',
    'export function plantedLabOnly(): number { return 19; }',
    'export function plantedUncalled(): number { return 1; }',
    'export function plantedViaBarrel(): number { return 2; }',
    'export function plantedCalledViaBarrel(): number { return 3; }',
    'export function plantedNamespacePinned(): number { return 4; }',
    'export const plantedShorthand = (): number => 5;',
    'export function plantedTypeOnly(): number { return 6; }',
    'export function plantedRecursive(n: number): number { return n <= 0 ? 0 : plantedRecursive(n - 1); }',
    'export function PlantedBadge(): null { return null; }',
    'export function plantedRequired(): number { return 7; }',
    'export const plantedConstant = 8;',
    'export default function (): number { return 9; }',
  ].join('\n'),
  [at(BARREL)]: [
    "export { plantedViaBarrel as barrelName, plantedCalledViaBarrel as barrelCalled } from './plantedQa116Module';",
    "export * from './plantedQa116Module';",
  ].join('\n'),
  [at(CALLER)]: [
    "import React from 'react';",
    "import { barrelCalled } from './plantedQa116Barrel';",
    "import { plantedShorthand, plantedTypeOnly, PlantedBadge } from './plantedQa116Module';",
    'export const plantedApi = { plantedShorthand };',
    'export type PlantedTypeOnly = typeof plantedTypeOnly;',
    'export const plantedValue = barrelCalled();',
    'export const plantedElement = <PlantedBadge />;',
    "export const plantedLazy = (): number => require('./plantedQa116Module').plantedRequired();",
    'export const plantedReact = React;',
    "import { PlantedBuilt } from './plantedQa116Module';",
    "import './plantedQa116Default';",
    'export const plantedBuilt = new PlantedBuilt();',
  ].join('\n'),
  [at(TEST)]: [
    "import plantedDefault, { plantedUncalled, plantedCalledViaBarrel, plantedShorthand, plantedTypeOnly, plantedRecursive, PlantedBadge, plantedRequired, plantedConstant } from '../plantedQa116Module';",
    "import { plantedDefaultReexported, PlantedClass, PlantedBuilt, plantedOverloaded, plantedOrphanCalled, plantedLabOnly } from '../plantedQa116Module';",
    "import type { plantedTypeImported } from '../plantedQa116Module';",
    "import { type plantedTypeSpecifier } from '../plantedQa116Module';",
    "import { barrelName } from '../plantedQa116Barrel';",
    "import * as m from '../plantedQa116Module';",
    "const { plantedDestructured } = require('../plantedQa116Module');",
    'it("pins", () => {',
    '  expect([plantedDefault(), plantedUncalled(), plantedCalledViaBarrel(), plantedShorthand(), plantedTypeOnly(), plantedRecursive(2), PlantedBadge(), plantedRequired(), plantedConstant, barrelName(), m.plantedNamespacePinned()]).toBeTruthy();',
    '  expect([plantedDefaultReexported(), new PlantedClass(), new PlantedBuilt(), plantedOverloaded(1), plantedOrphanCalled(), plantedLabOnly(), plantedDestructured()]).toBeTruthy();',
    "  expect(require('../plantedQa116Module').plantedRequirePinned()).toBe(16);",
    "  expect(jest.requireActual('../plantedQa116Module').plantedActualPinned()).toBe(17);",
    '  const typed: [typeof plantedTypeImported, typeof plantedTypeSpecifier] | null = null;',
    '  expect(typed).toBeNull();',
    '});',
  ].join('\n'),
};

let real: PinScan;
let plantedScan: PinScan;
const keys = (scan: PinScan) => scan.pinned.map((p) => p.key);
const find = (scan: PinScan, key: string) => scan.pinned.find((p) => p.key === key);

beforeAll(() => {
  real = scanPinnedExports(parsed);
  const bioAura = ts.sys.readFile(at(BIOAURA))!;
  const withoutCaller = bioAura.replace(
    "import { breathMsForArousal, arousalFromHr, hrGlowColor } from './auraBreath';",
    "import { breathMsForArousal, arousalFromHr } from './auraBreath';",
  );
  expect(withoutCaller).not.toBe(bioAura); // the planted removal really removes something
  plantedScan = scanPinnedExports(parsed, { ...planted, [at(BIOAURA)]: withoutCaller });
}, 2 * TIMEOUT);

describe('QA-116 · which files are production', () => {
  it.each([
    ['src/auth/auth.ts', true],
    ['src/experience/aura/BioAura.tsx', true],
    ['App.tsx', true],
    ['index.js', true],
    ['modules/spotify-remote/src/index.ts', true],
    ['src/auth/__tests__/loginFlow.test.ts', false],
    ['src/design/contrast.test.ts', false],
    ['src/testing/stores.ts', false],
    ['src/testing/guards/pinnedCallers.ts', false],
    ['src/__contracts__/deadList.ts', false],
    ['scripts/tsc/fullTsc.ts', false],
    ['jest.setup.js', false],
    ['index.lab.js', false],
    ['src/design/lab/LabRoot.tsx', false],
    ['node_modules/react/index.js', false],
  ])('%s -> %s', (rel, expected) => {
    expect(isProductionPath(at(rel))).toBe(expected);
  });

  it('agrees with productionFiles() on the real tree (src/__contracts__ and the Design Lab aside), so the two never drift', () => {
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(100);
    const disagree = files.filter((f) => !isProductionPath(f) && !/[\\/]src[\\/](__contracts__|design[\\/]lab)[\\/]|[\\/]index\.lab\.js$/.test(f));
    expect(disagree).toEqual([]);
  });
});

describe('QA-116 · the real tree', () => {
  it('pins exist and are counted (a scan over nothing would pass)', () => {
    console.log(`QA-116 guard: ${real.pinned.length} pinned callable exports, ${real.testFiles} test files, ${real.productionFiles} production files`);
    expect(real.pinned.length).toBeGreaterThan(0);
    expect(real.testFiles).toBeGreaterThan(100);
    expect(real.productionFiles).toBeGreaterThan(100);
    expect(real.releaseFiles).toBeGreaterThan(100);
  });

  it('a caller only in the Design Lab does not count: useRealtimeFieldClock is called from LabRoot.tsx alone', () => {
    const clock = find(real, 'src/design/v2/clock/fieldClock.ts#useRealtimeFieldClock');
    expect(clock!.tests.length).toBeGreaterThan(0);
    expect(clock!.callers).toEqual([]);
  });

  it('hrGlowColor is pinned and its only production caller is BioAura.tsx (the precondition of the removal control)', () => {
    const glow = find(real, 'src/experience/aura/auraBreath.ts#hrGlowColor');
    expect(glow).toBeDefined();
    expect(glow!.tests.length).toBeGreaterThan(0);
    expect(glow!.callers).toEqual([BIOAURA]);
  });
});

describe('QA-116 · planted controls (in memory)', () => {
  it('a virtual test importing an uncalled production function goes red', () => {
    const failures = pinFailures(plantedScan, []);
    expect(failures).toContainEqual(expect.stringContaining(`${MODULE}#plantedUncalled`));
    expect(find(plantedScan, `${MODULE}#plantedUncalled`)!.tests).toEqual([TEST]);
  });

  it("removing a real caller's import in memory turns that export red", () => {
    const glow = find(plantedScan, 'src/experience/aura/auraBreath.ts#hrGlowColor');
    expect(glow!.callers).toEqual([]);
    expect(pinFailures(plantedScan, [])).toContainEqual(expect.stringContaining('src/experience/aura/auraBreath.ts#hrGlowColor'));
  });

  it('a barrel re-export is followed to the declaring module, under its declared name, on both sides', () => {
    // pinned through the barrel under another name: reported at the declaration, and the re-export is no caller
    expect(find(plantedScan, `${MODULE}#plantedViaBarrel`)!.callers).toEqual([]);
    expect(keys(plantedScan)).not.toContain(`${BARREL}#barrelName`);
    expect(pinFailures(plantedScan, [])).toContainEqual(expect.stringContaining(`${MODULE}#plantedViaBarrel`));
    // called through the barrel under another name: the caller counts
    expect(find(plantedScan, `${MODULE}#plantedCalledViaBarrel`)!.callers).toEqual([CALLER]);
  });

  it('a namespace import pins its members; a non-callable export is never a pin', () => {
    expect(find(plantedScan, `${MODULE}#plantedNamespacePinned`)!.tests).toEqual([TEST]);
    expect(keys(plantedScan)).not.toContain(`${MODULE}#plantedConstant`);
  });

  it('a shorthand property and a JSX tag are callers; typeof, self-recursion and require() are not', () => {
    expect(find(plantedScan, `${MODULE}#plantedShorthand`)!.callers).toEqual([CALLER]);
    expect(find(plantedScan, `${MODULE}#PlantedBadge`)!.callers).toEqual([CALLER]);
    expect(find(plantedScan, `${MODULE}#plantedTypeOnly`)!.callers).toEqual([]);
    expect(find(plantedScan, `${MODULE}#plantedRecursive`)!.callers).toEqual([]);
    // require() is untyped, so a caller reached only through it is missed: the check errs red, never green
    expect(find(plantedScan, `${MODULE}#plantedRequired`)!.callers).toEqual([]);
  });

  it('RA-1: a caller in a module the release entry never reaches (the Design Lab, an orphan) does not count', () => {
    expect(isProductionPath(at(LAB))).toBe(false);
    expect(find(plantedScan, `${MODULE}#plantedLabOnly`)!.callers).toEqual([]);
    expect(find(plantedScan, `${MODULE}#plantedOrphanCalled`)!.callers).toEqual([]);
    const failures = pinFailures(plantedScan, []);
    expect(failures).toContainEqual(expect.stringContaining(`${MODULE}#plantedLabOnly`));
    expect(failures).toContainEqual(expect.stringContaining(`${MODULE}#plantedOrphanCalled`));
  });

  it('RA-2: export default x alone is no caller; import type pins nothing', () => {
    expect(find(plantedScan, `${MODULE}#plantedDefaultReexported`)!.callers).toEqual([]);
    expect(keys(plantedScan)).not.toContain(`${MODULE}#plantedTypeImported`);
    expect(keys(plantedScan)).not.toContain(`${MODULE}#plantedTypeSpecifier`);
  });

  it('RA-3: a class a test constructs is a pin; production construction is a caller; recursion in an overload body is not', () => {
    expect(find(plantedScan, `${MODULE}#PlantedClass`)!.callers).toEqual([]);
    expect(pinFailures(plantedScan, [])).toContainEqual(expect.stringContaining(`${MODULE}#PlantedClass`));
    expect(find(plantedScan, `${MODULE}#PlantedBuilt`)!.callers).toEqual([CALLER]);
    expect(find(plantedScan, `${MODULE}#plantedOverloaded`)!.callers).toEqual([]);
  });

  it('RA-5: a test that reaches a function through require() or jest.requireActual pins it', () => {
    for (const name of ['plantedDestructured', 'plantedRequirePinned', 'plantedActualPinned']) {
      expect({ name, tests: find(plantedScan, `${MODULE}#${name}`)?.tests }).toEqual({ name, tests: [TEST] });
    }
  });

  it('RA-4: a planted import that resolves to nothing is refused, never a silent pass', () => {
    const file = at('src/plantedRa4.ts');
    expect(() => scanPinnedExports(parsed, { [file]: "import { x } from './plantedRa4Missing/module'; export const y = x;" })).toThrow(/resolve/);
  }, TIMEOUT);

  it('an anonymous default export is pinned under the name default', () => {
    expect(find(plantedScan, `${MODULE}#default`)!.tests).toEqual([TEST]);
  });

  it('a dead-list entry clears exactly its own export', () => {
    const entry = { file: MODULE, name: 'plantedUncalled', row: 'OPS-000' };
    const failures = pinFailures(plantedScan, [entry]);
    expect(failures.some((f) => f.includes(`${MODULE}#plantedUncalled`))).toBe(false);
    expect(failures).toContainEqual(expect.stringContaining(`${MODULE}#plantedRecursive`));
  });

  it('a dead-list entry for a called export goes red (the list only shrinks)', () => {
    const failures = pinFailures(plantedScan, [{ file: MODULE, name: 'plantedShorthand', row: 'OPS-000' }]);
    expect(failures).toContainEqual(expect.stringMatching(new RegExp(`${MODULE}#plantedShorthand.*OPS-000.*production caller`)));
  });

  it('a dead-list entry for an export no test pins goes red, and so does a duplicate entry', () => {
    const notPinned = pinFailures(plantedScan, [{ file: MODULE, name: 'plantedNeverDeclared', row: 'OPS-000' }]);
    expect(notPinned).toContainEqual(expect.stringMatching(new RegExp(`${MODULE}#plantedNeverDeclared.*OPS-000.*no test pins`)));
    const entry = { file: MODULE, name: 'plantedUncalled', row: 'OPS-000' };
    expect(pinFailures(plantedScan, [entry, entry])).toContainEqual(expect.stringMatching(/twice/));
  });
});
