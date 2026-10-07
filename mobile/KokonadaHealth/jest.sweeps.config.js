// The sweeps project (UI-073): the never-red sweeps at full resolution, and E3's ledger storms on
// their full grid (QA-068). It has its own config, so `jest` and CI's `jest --ci` never run it and
// keep the coarse grids. CI runs it in its own gated job, with two workers:
// `jest --ci --config jest.sweeps.config.js --maxWorkers=2`.
//
// It reuses the unit project's transforms in a plain node environment, with no global stubs: the
// sweeps touch no React Native. Name such a test *.sweeps.test.ts; jestProjects.test.ts checks that
// the three projects together run exactly the tests on disk.
const { projects } = require('./jest.config.js');

const unit = projects.find((p) => p.displayName === 'unit');

module.exports = {
  projects: [
    {
      displayName: 'sweeps',
      rootDir: __dirname,
      testEnvironment: 'node',
      testMatch: ['**/*.sweeps.test.[jt]s?(x)'],
      transform: unit.transform,
      transformIgnorePatterns: unit.transformIgnorePatterns,
    },
  ],
};
