// The sweeps project (UI-073): the never-red sweeps at full resolution, and E3's ledger storms on
// their full grid (QA-068). It has its own config, so `jest` and CI's `jest --ci` never run it and
// keep the coarse grids. CI runs it in its own gated job, with two workers:
// `jest --ci --config jest.sweeps.config.js --maxWorkers=2`.
//
// It reuses the unit project's transforms in a plain node environment, with no global stubs: the
// sweeps touch no React Native. Name such a test *.sweeps.test.ts.
//
// sweeps-skia (law round 2, item 8): the real-Skia checks too slow for every PR (the never-red
// scenes), in the skia project's CanvasKit environment, setup and transforms, taken from it by
// reference. Name such a test *.sweeps.skia.test.ts. jestProjects.test.ts checks that the four projects
// of both configs together run exactly the tests on disk.
const { projects } = require('./jest.config.js');

const unit = projects.find((p) => p.displayName === 'unit');
const skia = projects.find((p) => p.displayName === 'skia');

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
    {
      ...skia,
      displayName: 'sweeps-skia',
      testMatch: ['**/*.sweeps.skia.test.[jt]s?(x)'],
      testPathIgnorePatterns: ['/node_modules/'],
    },
  ],
};
