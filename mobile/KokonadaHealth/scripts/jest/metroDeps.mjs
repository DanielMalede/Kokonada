// The dependencies Metro itself collects from one module, transformed as a bundle would transform it:
// this app's metro.config.js, its own transform options (getTransformOptions), and dev true or false.
// With dev false Metro inlines __DEV__ and folds the dead branch away BEFORE it collects dependencies, so
// a require inside `if (__DEV__)` is not a dependency of a release bundle at all.
//
//   node scripts/jest/metroDeps.mjs <appRoot> <file, relative to appRoot> <true|false> < source
//
// The source comes on stdin, so a test can hand it a planted variant of a real file. Prints a JSON array
// of the module specifiers. Exit 2 when the transform cannot run (never a pass).

import { createRequire } from 'node:module';
import path from 'node:path';

const [appRoot, file, devArg] = process.argv.slice(2);
if (!appRoot || !file || (devArg !== 'true' && devArg !== 'false')) {
  console.error('usage: metroDeps.mjs <appRoot> <file> <true|false> < source');
  process.exit(2);
}
const dev = devArg === 'true';
const require = createRequire(path.join(path.resolve(appRoot), 'package.json'));

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const source = Buffer.concat(chunks);

try {
  const { loadConfig } = require('metro-config');
  const config = await loadConfig({ cwd: path.resolve(appRoot) });
  const entry = path.join(config.projectRoot, file);
  const own = await config.transformer.getTransformOptions([entry], { dev, hot: false, platform: 'android' }, async () => []);
  const options = {
    dev,
    hot: false,
    minify: false,
    platform: 'android',
    type: 'module',
    inlinePlatform: true,
    inlineRequires: Boolean(own?.transform?.inlineRequires),
    experimentalImportSupport: Boolean(own?.transform?.experimentalImportSupport),
    nonInlinedRequires: own?.transform?.nonInlinedRequires ?? [],
    unstable_transformProfile: 'default',
    customTransformOptions: {},
  };
  const result = await require('metro-transform-worker').transform(config.transformer, config.projectRoot, file, source, options);
  process.stdout.write(JSON.stringify(result.dependencies.map((d) => d.name)));
} catch (error) {
  console.error(error);
  process.exit(2);
}
