// Generate src/design/v2/field/blueNoise.generated.ts, the field's static blue-noise tile.
//
//   node scripts/field/blueNoise.mjs              write the module
//   node scripts/field/blueNoise.mjs --check      fail if the committed module is stale

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blueNoiseModule } from './lib/blueNoise.mjs';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(APP_ROOT, 'src/design/v2/field/blueNoise.generated.ts');
const shown = path.relative(APP_ROOT, OUT).split(path.sep).join('/');
const text = blueNoiseModule();

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (current !== text) {
    console.error(`${shown} is stale: run node scripts/field/blueNoise.mjs`);
    process.exit(1);
  }
  console.log(`${shown} is fresh`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${shown}`);
}
