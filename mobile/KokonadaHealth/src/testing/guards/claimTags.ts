/// <reference types="node" />
// QA-108 and QA-109: title lints for claims a stub cannot back.
//
// QA-108: a test that claims Skia BEHAVIOUR (a shader compiles, uniforms stay finite, pixels come out
// right, a crash guard holds) must run in the real-Skia project (*.skia.test.*): under the unit project's
// global stub (jest.setup.js) it cannot fail. QA-109: a test that claims MOTION behaviour (stillness,
// per-frame work, frame rate, frame-callback or loop teardown) must run on the motion fakes (QA-046):
// the static Reanimated mock evaluates a derived value once. Either can be declared with a title tag
// ([skia], [motion]); the wording below catches the untagged ones. Naming a Skia component or reduced
// motion in a layout claim is not flagged: the G10 review reads what a title lint cannot.

import * as path from 'path';
import ts from 'typescript';
import { TESTING_ROOT } from './productionImports';
import { moduleSpecifiers, parseSource, readSource } from './sourceFiles';

/** The roots these lints enforce. v2 (src/design/v2) and pages (src/pages) join when their trees are on main. */
export const CLAIM_GUARD_ROOTS: string[] = [TESTING_ROOT];

const TEST_FNS = new Set(['it', 'test', 'describe', 'xit', 'fit', 'xtest', 'xdescribe', 'fdescribe']);

function rootIdentifier(e: ts.Expression): string | null {
  let x: ts.Expression = e;
  for (;;) {
    if (ts.isIdentifier(x)) return x.text;
    if (ts.isPropertyAccessExpression(x)) x = x.expression;
    else if (ts.isCallExpression(x)) x = x.expression; // describe.each([...])('title')
    else return null;
  }
}

/** Every it/test/describe title (string or plain template) in a source, in order. */
export function testTitles(source: string, fileName: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0])) {
      const root = rootIdentifier(n.expression);
      if (root && TEST_FNS.has(root)) out.push(n.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(parseSource(source, fileName));
  return out;
}

const SKIA_CLAIM = /\[skia\]|\bshaders?\b|\bsksl\b|\bruntime ?effect|\bcanvaskit\b|\bpixels?\b|\bskia\b[^\n]*\b(crash|compil\w*|nan|finite|draws?|drawn)\b/i;
const MOTION_CLAIM = /\[motion\]|\bstillness\b|\bstill under\b|\bper[- ]frame\b|\bframe[- ]rate\b|\b\d+\s*fps\b|\bframe callbacks?\b|\bcancelAnimation\b|\bloops?\b[^\n]*\b(stops?|stopped|running|torn down|teardown)\b/i;
const SKIA_FILE = /\.skia\.test\.[jt]sx?$/;
const MOTION_HARNESS = ['motion', 'teardown', 'focus'].map((m) => path.join(TESTING_ROOT, m));

export const isSkiaClaim = (title: string): boolean => SKIA_CLAIM.test(title);
export const isMotionClaim = (title: string): boolean => MOTION_CLAIM.test(title);

/** `file: title` for each Skia-behaviour claim outside a *.skia.test.* file. */
export function misplacedSkiaClaims(files: string[], read: (f: string) => string = readSource): string[] {
  return files.filter((f) => !SKIA_FILE.test(f))
    .flatMap((f) => testTitles(read(f), f).filter(isSkiaClaim).map((t) => `${path.basename(f)}: ${t}`));
}

/** `file: title` for each motion claim in a file that does not import the motion harness. */
export function uncitedMotionClaims(files: string[], read: (f: string) => string = readSource): string[] {
  return files.flatMap((f) => {
    const source = read(f);
    const cites = moduleSpecifiers(source, f).some((spec) => spec.startsWith('.')
      && MOTION_HARNESS.some((m) => path.resolve(path.dirname(f), spec).replace(/\.[jt]sx?$/, '') === m));
    return cites ? [] : testTitles(source, f).filter(isMotionClaim).map((t) => `${path.basename(f)}: ${t}`);
  });
}
