const preset = require('@react-native/jest-preset');

// Extend the preset transform (js/ts/tsx + assets) with .mjs so the brand asset scripts —
// ESM build tools that Node type-strips against the .ts geometry — are unit-testable too.
const transform = {
  ...preset.transform,
  '^.+\\.mjs$': 'babel-jest',
};

// The real-Skia tests (MB-086). The unit project stubs Skia for headless screen renders; these run
// in Skia's own jest environment instead, where CanvasKit (WASM) backs the Skia API, so a shader
// really compiles and a surface really draws. Name such a test *.skia.test.ts(x).
const SKIA_TESTS = '\\.skia\\.test\\.[jt]sx?$';

// The full-resolution never-red sweeps (UI-073) run only in jest.sweeps.config.js, in CI's own
// serial step; the default run keeps the coarse grids. Name such a test *.sweeps.test.ts.
const SWEEPS_TESTS = '\\.sweeps\\.test\\.[jt]sx?$';

// The CanvasKit sweeps (law round 2, item 8): real-Skia checks too slow for every PR, named
// *.sweeps.skia.test.ts. They run only in jest.sweeps.config.js (project sweeps-skia), so the skia
// project here leaves them out.
const SWEEPS_SKIA_TESTS = '\\.sweeps\\.skia\\.test\\.[jt]sx?$';

// Test-only fixtures (src/design/v2/__tests__/__fixtures__/: the close-out's fixture directions) sit
// under __tests__ but are never tests, so both projects leave them out; jestProjects.test.ts pins it.
const FIXTURES = '/__fixtures__/';

// Two projects, one run: `jest` (and CI's `jest --ci`) runs both. jestProjects.test.ts checks that
// together they run exactly the tests on disk, so a split can never silently drop a suite.
module.exports = {
  projects: [
    {
      displayName: 'unit',
      rootDir: __dirname,
      preset: '@react-native/jest-preset',
      setupFiles: ['<rootDir>/jest.setup.js'],
      moduleNameMapper: {
        '^@kokonada/spotify-remote$': '<rootDir>/modules/spotify-remote/src/index.ts',
      },
      transform,
      // The RN jest resolver prefers the `react-native`/`source` package field, which
      // for Redux Toolkit (and its deps) points at untranspiled TS/ESM. Allowlist them
      // through babel so the CJS/ESM source is transformed instead of failing to parse.
      transformIgnorePatterns: [
        'node_modules/(?!(?:@react-native|react-native|@reduxjs/toolkit|immer|redux|reselect|redux-thunk|react-redux|zustand|@react-navigation|react-native-screens|react-native-haptic-feedback)/)',
      ],
      testPathIgnorePatterns: ['/node_modules/', FIXTURES, SKIA_TESTS, SWEEPS_TESTS],
    },
    {
      displayName: 'skia',
      rootDir: __dirname,
      preset: '@react-native/jest-preset',
      // Skia 2.6.9's own environment (loads CanvasKit into the global) and setup (mocks the Skia
      // module with the CanvasKit-backed API). Never <rootDir>/jest.setup.js, which stubs Skia.
      testEnvironment: '@shopify/react-native-skia/jestEnv.js',
      setupFiles: ['@shopify/react-native-skia/jestSetup.js'],
      testMatch: ['**/*.skia.test.[jt]s?(x)'],
      testPathIgnorePatterns: ['/node_modules/', FIXTURES, SWEEPS_SKIA_TESTS],
      transform,
      // Skia's environment, setup and module build are ES modules, so they go through babel too.
      transformIgnorePatterns: [
        'node_modules/(?!(?:@react-native|react-native|@shopify/react-native-skia)/)',
      ],
    },
  ],
};
