'use strict';

// Local ESLint plugin, installed as `file:./tools/eslint-plugin-kokonada` (the same mechanism
// modules/spotify-remote already uses). It exists so the design system can be ENFORCED rather
// than documented: colour and scale values that bypass src/design/tokens.ts are build errors.

module.exports = {
  rules: {
    'no-color-literals': require('./lib/rules/no-color-literals'),
    'no-scale-literals': require('./lib/rules/no-scale-literals'),
    'require-disable-reason': require('./lib/rules/require-disable-reason'),
  },
};
