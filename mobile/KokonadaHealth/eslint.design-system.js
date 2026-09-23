// The design-system rule block: values that bypass src/design/tokens.ts are BUILD ERRORS.
//
// It lives in its own module because two entry points need exactly the same rules:
//   • .eslintrc.js                      — so editors and `npm run lint` show them inline
//   • scripts/lint/designSystemLint.mjs — the CI gate, which runs this same config and then
//                                         keeps only the kokonada/* findings, so unrelated
//                                         pre-existing lint debt cannot decide whether it passes
// One definition, two consumers, no drift.
//
// Why this exists: an undeclared #3A5CCC reached production styling as a base-scope default and
// painted across many surfaces before anyone noticed. Colour is DEFINED in src/design/ and read
// everywhere else; the same goes for the spacing, radius and type scales.

const APP_SOURCE = ['src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx'];

module.exports = {
  plugins: ['kokonada'],

  overrides: [
    {
      // Scoped to src/** — build tooling and the lint plugin's own fixtures are not app styling.
      files: APP_SOURCE,
      rules: {
        'kokonada/no-color-literals': 'error',
        'kokonada/no-scale-literals': 'error',
        // The escape hatch is deliberately awkward: suppressing a design-system rule requires a
        // written reason on the same line (`-- because ...`). A bare disable is itself an error.
        'kokonada/require-disable-reason': 'error',
        // An inline `/* eslint kokonada/no-color-literals: off */` switches a rule off for a whole
        // file without ever being a disable DIRECTIVE — so nothing else here sees it. This gives
        // the author a red squiggle; scripts/lint/designSystemLint.mjs is the backstop that a
        // comment cannot talk its way past.
        'eslint-comments/no-use': ['error', {
          allow: ['eslint-disable', 'eslint-disable-line', 'eslint-disable-next-line', 'eslint-enable'],
        }],
      },
    },
    {
      // The exemption is for the files that DEFINE the system's values, plus the tests that PIN
      // them — `expect(colors.dark.content.muted).toBe('#A7A6D0')` is the palette's specification,
      // not a screen bypassing it, and a rule that bans hex there bans the lock on the values.
      //
      // Deliberately NOT all of src/design/**. src/design/system/ and src/design/components/ are
      // UI components: they CONSUME the palette exactly like a screen, and blanket-exempting the
      // directory is how off-system border widths (EmptyState 2 and 1.5, OfflineBanner 1) came to
      // sit in the one place the rule was switched off.
      files: ['src/design/*.ts', 'src/design/__tests__/**'],
      rules: {
        'kokonada/no-color-literals': 'off',
        'kokonada/no-scale-literals': 'off',
      },
    },
  ],
};
