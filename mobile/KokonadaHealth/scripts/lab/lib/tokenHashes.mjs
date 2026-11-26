// The token hashes a lab stamp carries (UI-278), so device evidence can be checked against the token files it was built
// from (UI-119): the sha256 of every design-tokens/*.tokens.json, the token sources at the repository root, and of every
// src/design/v2/tokens/*.generated.ts, the modules scripts/tokens/generate.mjs makes from them, which the bundle imports.
// `*` is one path segment. Each file is keyed by its path from the repository root, with forward slashes, so a key reads
// the same on every machine. The bytes are the working tree's: bundleLab reads them only from a clean commit, and
// .gitattributes keeps them LF, so each hash is the one computed from the commit, and a source's is the one the
// generator records for it (TOKENS_SOURCE).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Refused } from './stamp.mjs';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// Each kind of token file: its folder, from the repository root or from the app's, and how its name ends.
const KINDS = [
  { glob: 'design-tokens/*.tokens.json', root: 'repo', dir: 'design-tokens', name: /\.tokens\.json$/ },
  { glob: 'src/design/v2/tokens/*.generated.ts', root: 'app', dir: 'src/design/v2/tokens', name: /\.generated\.ts$/ },
];

/**
 * { [path from the repository root]: sha256 } for every token file, in path order. Throws Refused when a kind has no
 * file, or a file is outside the repository: a lab stamp is never made without them.
 * @param {{ repoRoot: string, appRoot: string }} roots
 * @returns {Record<string, string>}
 */
export function tokenHashes({ repoRoot, appRoot }) {
  const roots = { repo: path.resolve(repoRoot), app: path.resolve(appRoot) };
  const hashes = [];
  for (const kind of KINDS) {
    const dir = path.join(roots[kind.root], kind.dir);
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((name) => kind.name.test(name)).map((name) => path.join(dir, name)).filter((file) => fs.statSync(file).isFile())
      : [];
    if (files.length === 0) throw new Refused(`no ${kind.glob} in ${dir}: a lab stamp carries the sha256 of every token file (UI-278)`);
    for (const file of files) {
      const key = path.relative(roots.repo, file).split(path.sep).join('/');
      if (key.startsWith('../') || path.isAbsolute(key)) throw new Refused(`${file} is not inside the repository ${roots.repo}`);
      hashes.push([key, sha256(fs.readFileSync(file))]);
    }
  }
  return Object.fromEntries(hashes.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
