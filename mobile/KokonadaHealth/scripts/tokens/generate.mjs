// Generate src/design/v2/tokens/tokens.generated.ts from design-tokens/*.tokens.json.
//
//   node scripts/tokens/generate.mjs              write the module
//   node scripts/tokens/generate.mjs --check      fail if the committed module is stale
//   --sources <dir> and --out <file> point it elsewhere (the tests use them).
//
// The colour core is imported by its .ts path; Node's type stripping loads it, as the brand
// scripts already do. Exit 1, with the reason on stderr, on a schema error or a stale module.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateTokensModule } from './lib/emit.mjs';
import { validateSources } from './lib/schema.mjs';
import { readTokenSources } from './lib/sources.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : fallback;
};
const SOURCES = option('--sources', path.resolve(APP_ROOT, '../../design-tokens'));
const OUT = option('--out', path.join(APP_ROOT, 'src/design/v2/tokens/tokens.generated.ts'));
const shown = (file) => path.relative(APP_ROOT, file).split(path.sep).join('/');

let text;
try {
  const sources = readTokenSources(SOURCES);
  for (const note of validateSources(sources).notes) {
    console.log(`note: ${note}`);
  }
  text = generateTokensModule(sources);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (args.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (current !== text) {
    console.error(`${shown(OUT)} is stale: run node scripts/tokens/generate.mjs`);
    process.exit(1);
  }
  console.log(`${shown(OUT)} is fresh`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${shown(OUT)}`);
}
