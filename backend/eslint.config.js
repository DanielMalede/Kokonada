'use strict';

/**
 * W4-D11 — the linter this repo never had.
 *
 * §2 step 7 has required "lint clean" of every Wave-4 task since session 1, and there was no
 * linter: no config, no dependency, no script. The line was reported satisfied every session and
 * gated nothing. The interval that queued this task also produced the defect it catches — W4-D08
 * called `insertManyAccounted` in `suunto.js` without requiring it, shipping a `ReferenceError` on
 * every Suunto webhook past a green 172-suite run and an open PR, because every test touching that
 * module mocks it away.
 *
 * DELIBERATELY MINIMAL. The goal is a real gate on the class of defect that just escaped, not a
 * style regime imposed on ~150 pre-existing files:
 *   · `no-undef` is an ERROR — it is the rule that finds the W4-D08 class, and the production
 *     surface is clean of it today (verified by scope analysis over all 147 files in reflection #2).
 *   · `no-unused-vars` is a WARNING — real signal, but pre-existing debt must not fail a build, and
 *     mass-rewriting untouched files is explicitly out of scope for this task.
 * Everything else stays off. A linter that shouts about formatting on day one is a linter the next
 * session learns to ignore, and an ignored gate is the thing being fixed here.
 *
 * The enforcement lives in `tests/wave4.lintGuard.test.js` (the run's guard precedent: W4-D01's
 * marker, W4-D02's state-guard, W4-D06's open-handle guard all run inside the suite), so a future
 * session cannot reintroduce an undefined identifier by simply not running `npm run lint`.
 */

const globals = require('globals');

// Sources are CommonJS Node throughout — no build step, no ESM, no browser surface.
const commonjsNode = {
  ecmaVersion: 2024,
  sourceType: 'commonjs',
  globals: { ...globals.node },
};

const RULES = {
  'no-undef': 'error',
  // `_`-prefixed names are the codebase's existing convention for a deliberately unused binding
  // (destructured-and-dropped fields, placeholder callback args).
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
};

module.exports = [
  {
    // Vendored, generated and out-of-scope trees. `mobile/` is a separate React Native package and
    // is out of scope for this wave entirely (mission §0.3).
    ignores: ['node_modules/**', 'coverage/**', '**/*.min.js'],
  },
  {
    // The gated production surface.
    files: ['app/**/*.js', 'sim/**/*.js'],
    languageOptions: commonjsNode,
    rules: RULES,
  },
  {
    // Linted by `npm run lint`, not gated by the suite: these legitimately carry test globals.
    files: ['tests/**/*.js', 'jest/**/*.js'],
    languageOptions: {
      ...commonjsNode,
      globals: { ...globals.node, ...globals.jest },
    },
    rules: RULES,
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: commonjsNode,
    rules: RULES,
  },
];
