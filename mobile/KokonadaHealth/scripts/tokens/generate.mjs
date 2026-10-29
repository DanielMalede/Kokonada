// Generate src/design/v2/tokens/tokens.generated.ts and tokens.extensions.generated.ts from
// design-tokens/*.tokens.json.
//
//   node scripts/tokens/generate.mjs              write the modules
//   node scripts/tokens/generate.mjs --check      fail if a committed module is stale
//   --sources <dir> and --out <file> point it elsewhere (the tests use them); the extensions module
//   is written beside --out as tokens.extensions.generated.ts.
//
// The colour core is imported by its .ts path; Node's type stripping loads it, as the brand
// scripts already do. Exit 1, with the reason on stderr, on a schema error or a stale module.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateExtensionsModule, generateTokensModule } from './lib/emit.mjs';
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

/** The two modules, written side by side: the extensions beside --out. */
const OUT_EXTENSIONS = path.join(path.dirname(OUT), 'tokens.extensions.generated.ts');

let outputs;
try {
  const sources = readTokenSources(SOURCES);
  for (const note of validateSources(sources).notes) {
    console.log(`note: ${note}`);
  }
  outputs = [
    [OUT, generateTokensModule(sources)],
    [OUT_EXTENSIONS, generateExtensionsModule(sources)],
  ];
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (args.includes('--check')) {
  let stale = false;
  for (const [file, text] of outputs) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current !== text) {
      console.error(`${shown(file)} is stale: run node scripts/tokens/generate.mjs`);
      stale = true;
    } else {
      console.log(`${shown(file)} is fresh`);
    }
  }
  if (stale) {
    process.exit(1);
  }
} else {
  for (const [file, text] of outputs) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`wrote ${shown(file)}`);
  }
}
