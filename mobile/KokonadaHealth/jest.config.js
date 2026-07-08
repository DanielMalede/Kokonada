module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@kokonada/spotify-remote$': '<rootDir>/modules/spotify-remote/src/index.ts',
  },
  // The RN jest resolver prefers the `react-native`/`source` package field, which
  // for Redux Toolkit (and its deps) points at untranspiled TS/ESM. Allowlist them
  // through babel so the CJS/ESM source is transformed instead of failing to parse.
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|@reduxjs/toolkit|immer|redux|reselect|redux-thunk|react-redux|zustand|@react-navigation|react-native-screens|@tamagui|tamagui)/)',
  ],
};
