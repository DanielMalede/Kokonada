/// <reference types="node" />
import * as path from 'path';
import { APP_ROOT } from '../guards/productionImports';
import { isTestFile, walkSources } from '../guards/sourceFiles';
import { CLAIM_GUARD_ROOTS, misplacedSkiaClaims, testTitles, uncitedMotionClaims } from '../guards/claimTags';

// QA-108: Skia behaviour (shader compilation, NaN safety, pixel output) is claimed only in the real-
// Skia project (*.skia.test.*), never under the global Skia stub, where it cannot fail
// (BioAura.test.tsx's "Skia crash guard", OPS-024). QA-109: a motion claim (stillness, teardown, frame
// rate) is made only in a suite on the motion fakes (QA-046), never under the static Reanimated mock
// that evaluates a derived value once (MB-044). Both are title lints; the G10 review reads the rest.
// Enforced over the opt-in roots; planted sources are assembled in memory.

const at = (rel: string) => path.join(APP_ROOT, rel);
const q = (s: string) => String.fromCharCode(39) + s + String.fromCharCode(39);

describe('the title reader', () => {
  it('reads it/test/describe titles in every form, and nothing else', () => {
    const src = [
      'describe(' + q('outer') + ', () => {',
      '  it(' + q('a') + ', () => {});',
      '  test.only(' + q('b') + ', () => {});',
      '  it.each([1])(' + q('c %s') + ', () => {});',
      '  describe.each([[1]])(' + q('d %s') + ', () => {});',
      '  const s = ' + q('it("not a title")') + ';',
      '});',
    ].join('\n');
    expect(testTitles(src, 'x.test.ts')).toEqual(['outer', 'a', 'b', 'c %s', 'd %s']);
  });

  it('scans real test files in the opt-in roots (an empty input set must fail, not pass)', () => {
    expect(CLAIM_GUARD_ROOTS.map((r) => path.relative(APP_ROOT, r).split(path.sep).join('/'))).toEqual(['src/testing']);
    const files = CLAIM_GUARD_ROOTS.flatMap((r) => walkSources(r)).filter(isTestFile);
    expect(files.length).toBeGreaterThan(10);
    expect(files.flatMap((f) => testTitles(require('fs').readFileSync(f, 'utf8'), f)).length).toBeGreaterThan(100);
  });
});

describe('QA-108 · Skia behaviour only in the real-Skia project', () => {
  it('finds 0 misplaced Skia claims in the opt-in roots', () => {
    const files = CLAIM_GUARD_ROOTS.flatMap((r) => walkSources(r)).filter(isTestFile);
    expect(misplacedSkiaClaims(files)).toEqual([]);
  });

  it.each([
    ['compiles the field shader'],
    ['the Skia crash guard renders without throwing'],
    ['[skia] NaN uniforms draw finite pixels'],
    ['RuntimeEffect.Make returns null on a syntax error'],
  ])('planted: %s, under the stub, is flagged', (title) => {
    const src = 'it(' + q(title) + ', () => {});';
    expect(misplacedSkiaClaims([at('src/experience/x/__tests__/planted.test.tsx')], () => src)).toHaveLength(1);
    expect(misplacedSkiaClaims([at('src/experience/x/__tests__/planted.skia.test.tsx')], () => src)).toEqual([]);
  });

  it('a layout claim that only names a Skia component is not a behaviour claim', () => {
    const src = 'it(' + q('wraps the Skia wheel in an adjustable View with its label') + ', () => {});';
    expect(misplacedSkiaClaims([at('src/x/__tests__/planted.test.tsx')], () => src)).toEqual([]);
  });
});

describe('QA-109 · motion claims only on the motion fakes', () => {
  it('finds 0 uncited motion claims in the opt-in roots', () => {
    const files = CLAIM_GUARD_ROOTS.flatMap((r) => walkSources(r)).filter(isTestFile);
    expect(uncitedMotionClaims(files)).toEqual([]);
  });

  it.each([
    ['reduced motion stops the per-frame recompute'],
    ['the field is still under reduced motion (stillness)'],
    ['tears down its frame callbacks on unmount'],
    ['[motion] holds 60 fps'],
    ['cancelAnimation runs on unmount'],
  ])('planted: %s, without the motion fakes, is flagged', (title) => {
    const bare = 'it(' + q(title) + ', () => {});';
    const onFakes = 'import { installMotionFakes } from ' + q('../../../testing/motion') + ';\n' + bare;
    const file = at('src/experience/x/__tests__/planted.test.tsx');
    expect(uncitedMotionClaims([file], () => bare)).toHaveLength(1);
    expect(uncitedMotionClaims([file], () => onFakes)).toEqual([]);
  });

  it('a layout claim under reduced motion is not a motion-behaviour claim', () => {
    const src = 'it(' + q('reduced motion — the list settles at rest (opacity 1), layout unchanged') + ', () => {});';
    expect(uncitedMotionClaims([at('src/x/__tests__/planted.test.tsx')], () => src)).toEqual([]);
  });
});
