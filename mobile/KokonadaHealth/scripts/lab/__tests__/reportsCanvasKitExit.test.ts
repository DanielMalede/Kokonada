/// <reference types="node" />
// No script that loads CanvasKit exits through process.exit() (B8-8e; the B8 squad δ report's proposed row 5). On
// Windows, exiting while CanvasKit's WebAssembly still has background work trips a libuv assertion (src/win/async.c,
// "!(handle->flags & UV_HANDLE_CLOSING)"): the process dies with exit 127 or 0xC0000409 instead of its own code, so a
// report's verdict is lost (seen at a3f3ea5 on neverRed.mts). Such a script sets process.exitCode and returns.
//
// "Loads CanvasKit" is followed through relative imports: lawParity.mts never names canvaskit-wasm, but evidence.mts
// imports png.mjs, which does. Every .mts and .mjs under scripts/lab/ and scripts/field/ is checked; comments are not code.

import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(__dirname, '../../..');
const ROOTS = ['scripts/lab', 'scripts/field'];

function scripts(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(APP, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(r);
      } else if (/\.m[jt]s$/.test(e.name)) out.push(r);
    }
  };
  ROOTS.forEach(walk);
  return out.sort();
}

/** The source without its comments (line and block), strings kept. */
export function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Does `rel` (or any module it imports relatively, transitively) load CanvasKit? `read` gives a module's source. */
export function loadsCanvasKit(rel: string, read: (rel: string) => string | null, seen = new Set<string>()): boolean {
  if (seen.has(rel)) return false;
  seen.add(rel);
  const text = read(rel);
  if (text === null) return false;
  const src = code(text);
  if (/canvaskit-wasm/.test(src)) return true;
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
    const next = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
    if (loadsCanvasKit(next, read, seen)) return true;
  }
  return false;
}

/** The scripts that load CanvasKit and call process.exit(, from a source reader. */
export function offenders(files: readonly string[], read: (rel: string) => string | null): string[] {
  return files.filter((f) => loadsCanvasKit(f, read) && /\bprocess\.exit\s*\(/.test(code(read(f) ?? '')));
}

const disk = (rel: string) => (fs.existsSync(path.join(APP, rel)) ? fs.readFileSync(path.join(APP, rel), 'utf8') : null);

describe('no CanvasKit script under scripts/lab or scripts/field exits through process.exit()', () => {
  it('the guard: the scan sees the CanvasKit scripts, through imports too', () => {
    const files = scripts();
    const ck = files.filter((f) => loadsCanvasKit(f, disk));
    expect(ck).toEqual(expect.arrayContaining([
      'scripts/lab/lib/png.mjs', 'scripts/lab/capture.mjs', 'scripts/lab/reports/lib/evidence.mts',
      'scripts/lab/reports/lawParity.mts', 'scripts/lab/reports/neverRed.mts',
    ]));
    // bandEvidence.mts calls process.exit() and loads no CanvasKit: the rule leaves it alone.
    expect(files).toContain('scripts/field/bandEvidence.mts');
    expect(ck).not.toContain('scripts/field/bandEvidence.mts');
  });

  it('none of them calls process.exit(', () => {
    expect(offenders(scripts(), disk)).toEqual([]);
  });
});

describe('the pattern bites', () => {
  const planted: Record<string, string> = {
    'a/direct.mts': "import CanvasKitInit from 'canvaskit-wasm/bin/full/canvaskit.js';\nprocess.exit(1);\n",
    'a/lib/png.mjs': "import CanvasKitInit from 'canvaskit-wasm/bin/full/canvaskit.js';\nexport const x = 1;\n",
    'a/through.mts': "import { x } from './lib/png.mjs';\nmain().then((c) => process.exit (c));\n",
    'a/dynamic.mts': "const m = await import('./lib/png.mjs');\nprocess.exit(0);\n",
    'a/plain.mts': "import fs from 'node:fs';\nprocess.exit(1);\n",
    'a/commented.mts': "import { x } from './lib/png.mjs';\n// never process.exit(): see above\n/* process.exit(2) */\nprocess.exitCode = 1;\n",
  };
  const read = (rel: string) => planted[rel] ?? null;

  it('flags a direct, an imported and a dynamically imported CanvasKit script that calls process.exit(', () => {
    expect(offenders(Object.keys(planted), read).sort()).toEqual(['a/direct.mts', 'a/dynamic.mts', 'a/through.mts']);
  });

  it('leaves a script with no CanvasKit, and one that names process.exit only in comments', () => {
    expect(offenders(['a/plain.mts', 'a/commented.mts'], read)).toEqual([]);
  });
});
