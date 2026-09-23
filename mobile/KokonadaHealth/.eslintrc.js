const designSystem = require('./eslint.design-system');

module.exports = {
  root: true,
  extends: '@react-native',
  plugins: designSystem.plugins,
  overrides: [
    ...designSystem.overrides,
    {
      // The local ESLint plugin is CommonJS tooling, not app code.
      files: ['tools/**/*.js'],
      env: { node: true, jest: true },
    },
  ],
};
