'use strict';

const path = require('path');
const { loadTokenIndex } = require('./tokenIndex');

const DEFAULT_TOKENS_PATH = 'src/design/tokens.ts';

/** Shared `tokensPath` option schema for the design-system rules. */
const tokensPathSchema = {
  type: 'object',
  properties: {
    tokensPath: {
      type: 'string',
      description: 'Path to the design tokens file, relative to the eslint cwd.',
    },
  },
  additionalProperties: false,
};

/** The value-indexed tokens file for this lint run. */
function tokensFor(context) {
  const opts = (context.options && context.options[0]) || {};
  const rel = opts.tokensPath || DEFAULT_TOKENS_PATH;
  const cwd = context.cwd || (context.getCwd && context.getCwd()) || process.cwd();
  return loadTokenIndex(path.isAbsolute(rel) ? rel : path.resolve(cwd, rel));
}

module.exports = { tokensFor, tokensPathSchema, DEFAULT_TOKENS_PATH };
