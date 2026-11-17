'use strict';

const { normalizeAnchoredResult } = require('./adapter');
const { buildSyntheticQueries } = require('./syntheticFixtures');

const limitations = [
  'native-library-not-installed', 'device-read-unverified', 'permission-state-unknown',
  'no-network-request', 'no-durable-sync', 'no-anchor-checkpoint', 'no-release-compatibility-proof',
];
const args = process.argv.slice(2);
const scenario = args.length === 0 ? 'demo' : args[1];
const validArguments = args.length === 0 || (args.length === 2 && args[0] === '--scenario');
const reportBase = { fixture: 'synthetic', nativePathVerified: false, anchorPersisted: false, limitations };

if (!validArguments || !new Set(['demo', 'empty', 'invalid-unit']).has(scenario)) {
  process.stdout.write(`${JSON.stringify({ ...reportBase, verdict: 'usage-error', code: 'invalid_arguments' })}\n`);
  process.exitCode = 2;
} else {
  try {
    const counts = { queries: 0, upserts: 0, deletes: 0, excluded: 0 };
    for (const query of buildSyntheticQueries(scenario)) {
      const output = normalizeAnchoredResult(query);
      counts.queries += 1;
      counts.upserts += output.counts.upserts;
      counts.deletes += output.counts.deletes;
      counts.excluded += output.counts.excluded;
    }
    process.stdout.write(`${JSON.stringify({
      ...reportBase, verdict: counts.upserts + counts.deletes > 0 ? 'contract-compatible' : 'no-visible-data', counts,
    })}\n`);
  } catch (error) {
    // The built-in rejection scenario can expose only this fixed safe code.
    const code = error.code === 'unexpected_native_unit' ? 'unexpected_native_unit' : 'probe_failed';
    process.stdout.write(`${JSON.stringify({ ...reportBase, verdict: 'rejected', code })}\n`);
    process.exitCode = 1;
  }
}
