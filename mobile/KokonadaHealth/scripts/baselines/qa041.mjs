// QA-041 proper (OPS-412 part A): the test-count floor CLI. It reads `jest --ci --json` output and compares
// it with scripts/baselines/test-counts.json, less the rows of the files RETIRE entries retire; it bounds the
// pending and todo tests (RA-5), checks that every manifest test passed (RA-7, mobile) and that the floor list
// is the tree at its SHA (RA-9, mobile).
//
//   mobile, from mobile/KokonadaHealth:
//     node scripts/baselines/qa041.mjs --package mobile --results <f> [--results <f>...] [--expect-shards 8] --head "$HEAD_SHA"
//   backend, from backend:
//     node ../mobile/KokonadaHealth/scripts/baselines/qa041.mjs --package backend --results "$RUNNER_TEMP/jest-backend.json" --head "$HEAD_SHA"
//   node scripts/baselines/qa041.mjs --check-inputs      the data modules load through Node (0) or not (2)
//
// Exit codes: 0 verified · 1 a breach · 2 cannot verify. 2 is never a pass. The report is on stdout.
//
// This entry is thin: it checks that this Node strips TypeScript types, loads the core (./qa041.ts), the
// adapters (./qa041Sources.ts) and the data modules by `await import()`, catches every throw and maps the
// verdict to the exit code. Each specifier is a literal, so __tests__/qa041.cli.test.ts follows every module
// it loads. It reads no environment variable.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const firstLine = (e) => String(e instanceof Error ? e.message : e).split('\n')[0];

/** The core's report shape, for what fails before the core is loaded. */
function cannotVerify(lines) {
  process.stdout.write(`QA-041: CANNOT VERIFY (exit 2, never a pass)\n${lines.map((l) => `  - ${l}`).join('\n')}\n`);
  return 2;
}

async function imported(load) {
  try {
    return { value: await load() };
  } catch (e) {
    return { error: firstLine(e) };
  }
}

async function main(argv) {
  const stripping = process.features && process.features.typescript;
  if (!stripping) {
    return cannotVerify([`this Node (${process.version}) cannot strip TypeScript types (process.features.typescript is ${String(stripping)}); QA-041 runs on Node 22.18 or later, or 24`]);
  }
  let core;
  let sources;
  try {
    core = await import('./qa041.ts');
    sources = await import('./qa041Sources.ts');
  } catch (e) {
    return cannotVerify([`the QA-041 core did not load: ${firstLine(e)}`]);
  }
  const parsed = core.parseArgs(argv);
  if ('usage' in parsed) {
    process.stdout.write(core.formatVerdict(null, { exit: 2, lines: [parsed.usage, core.USAGE] }));
    return 2;
  }
  const { args } = parsed;
  const mobile = args.mode === 'inputs' || args.pkg === 'mobile';
  const modules = {
    testCounts: await imported(() => import('./testCounts.ts')),
    retire: mobile ? await imported(() => import('../../src/__contracts__/retire.ts')) : undefined,
    manifest: mobile ? await imported(() => import('../../src/__contracts__/manifest.ts')) : undefined,
    floor: mobile ? await imported(() => import('../../src/__contracts__/testFloor.baseline.ts')) : undefined,
  };
  const data = sources.loadData(APP_ROOT, modules);
  if (args.mode === 'inputs') {
    const verdict = core.checkInputs(data);
    process.stdout.write(core.formatVerdict('inputs', verdict));
    return verdict.exit;
  }
  const verdict = core.decide(sources.collect(APP_ROOT, args, data));
  process.stdout.write(core.formatVerdict(args.pkg, verdict));
  return verdict.exit;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  process.exitCode = cannotVerify([`QA-041 could not run: ${firstLine(e)}`]);
}
