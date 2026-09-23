'use strict';

// Colour may be DEFINED in src/design/ and nowhere else. Everywhere else reads it from the
// palette. An undeclared #3A5CCC once reached production styling as a base-scope default and
// painted across many surfaces before anyone noticed; this rule is the thing that catches that
// on the day it is typed. The exemption for the token-defining files is applied in
// eslint.design-system.js, so the rule itself stays path-agnostic and testable.

const { tokensFor, tokensPathSchema } = require('../resolveTokens');

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const COLOR_FN = /^(?:rgba?|hsla?)\(/i;
const HEX_CHARS = /^[0-9a-fA-F]*$/;

function isColorString(value) {
  if (typeof value !== 'string') { return false; }
  const s = value.trim();
  return HEX.test(s) || COLOR_FN.test(s);
}

/** A template is a colour when it is an interpolated rgb()/hsl() call, or `#` + hex parts.
 *  The trailing-quasi check keeps `#${count} items` out of it. */
function isColorTemplate(node) {
  const quasis = node.quasis.map((q) => q.value.cooked || '');
  if (COLOR_FN.test(quasis[0])) { return true; }
  if (!/^#[0-9a-fA-F]*$/.test(quasis[0])) { return false; }
  return quasis.slice(1).every((q) => HEX_CHARS.test(q));
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban colour literals (hex, rgb/rgba, hsl/hsla) outside src/design — colour comes from the token palette.',
    },
    schema: [tokensPathSchema],
    messages: {
      knownColor:
        "Colour literal '{{value}}' bypasses the design system — it is {{token}} in " +
        'src/design/tokens.ts. Read it from the palette (screens use useTheme()) instead of ' +
        'hardcoding the hex; literal colour is allowed only under src/design/.',
      unknownColor:
        "Colour literal '{{value}}' bypasses the design system, and no token in " +
        'src/design/tokens.ts declares it. Add it to the palette there and read it through ' +
        'useTheme(); literal colour is allowed only under src/design/.',
    },
  },

  create(context) {
    const tokens = tokensFor(context);

    // Naming the token is what turns the error into a fix instead of a disable comment.
    const report = (node, value) => {
      const token = tokens.colorPath(value);
      context.report({
        node,
        messageId: token ? 'knownColor' : 'unknownColor',
        data: { value, token: token || '' },
      });
    };

    return {
      Literal(node) {
        if (isColorString(node.value)) { report(node, node.value); }
      },
      TemplateLiteral(node) {
        if (!isColorTemplate(node)) { return; }
        // With no interpolation the value is fully known, so it can still resolve to a token.
        if (node.expressions.length === 0) {
          report(node, node.quasis[0].value.cooked || '');
          return;
        }
        const sourceCode = context.sourceCode || context.getSourceCode();
        report(node, sourceCode.getText(node));
      },
    };
  },
};
