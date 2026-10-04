// The sweeps project (UI-073): the never-red sweeps at full resolution. It has its own config, so
// `jest` and CI's `jest --ci` never run it and keep the coarse grids. CI runs it serially, in its own
// step after the default run: `jest --ci --config jest.sweeps.config.js --runInBand`.
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
