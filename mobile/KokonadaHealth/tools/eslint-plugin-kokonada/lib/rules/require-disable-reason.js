'use strict';

// The design-system rules get exactly ONE escape hatch, and it is deliberately awkward:
// a disable must carry a written reason on the same line. A bare disable is itself an error,
// because the failure mode this whole thing guards against is an error being silenced rather
// than fixed.
//
// Scoped to the design-system rules on purpose. Making EVERY disable in the repo need a reason
// is a reasonable thing to want, but it is a different change with a different blast radius
// (eslint-comments/require-description does it) — and folding it in here would turn unrelated
// pre-existing disables into CI failures for a task that is about off-system values.

// `<kind> <rules> -- <description>`, the same shape ESLint itself parses. `-next-line` has to be
// tried before `-line`, and the lookahead stops `eslint-disable-anything-else` from matching.
const DIRECTIVE = /^\s*(eslint-disable(?:-next-line|-line)?)(?![\w-])/;
const DESCRIPTION_SEPARATOR = /\s-{2,}\s/;

const DEFAULT_PREFIX = 'kokonada/';
const REASON_PLACEHOLDER = '<why the token system cannot express this>';

function parseDirective(comment) {
  const match = DIRECTIVE.exec(comment.value);
  if (!match) { return null; }
  const rest = comment.value.slice(match[0].length);
  const separator = DESCRIPTION_SEPARATOR.exec(rest);
  const ruleText = (separator ? rest.slice(0, separator.index) : rest).trim();
  const description = separator ? rest.slice(separator.index + separator[0].length).trim() : '';
  return {
    kind: match[1],
    rules: ruleText ? ruleText.split(',').map((r) => r.trim()).filter(Boolean) : [],
    description,
  };
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require a written reason on any comment that disables a design-system rule.',
    },
    schema: [{
      type: 'object',
      properties: {
        rulePrefix: {
          type: 'string',
          description: 'Rule-name prefix the reason requirement applies to.',
        },
      },
      additionalProperties: false,
    }],
    messages: {
      missingReason:
        'This disable has no reason. A design-system rule may only be suppressed with a written ' +
        "reason on the same line — write '{{suggestion}}'. A bare disable comment is itself a " +
        'lint error.',
      blanketDisable:
        'The blanket disable on line {{line}} turns off every rule, including the design-system ' +
        'rules, and carries no reason. Name the rules and give a reason on the same line — ' +
        "'{{suggestion}}'. A bare disable comment is itself a lint error.",
    },
  },

  create(context) {
    const opts = (context.options && context.options[0]) || {};
    const prefix = opts.rulePrefix || DEFAULT_PREFIX;
    const sourceCode = context.sourceCode || context.getSourceCode();

    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          const directive = parseDirective(comment);
          if (!directive || directive.description) { continue; }

          const blanket = directive.rules.length === 0;
          if (!blanket && !directive.rules.some((r) => r.startsWith(prefix))) { continue; }

          if (!blanket) {
            context.report({
              loc: comment.loc,
              messageId: 'missingReason',
              data: {
                suggestion: `${directive.kind} ${directive.rules.join(', ')} -- ${REASON_PLACEHOLDER}`,
              },
            });
            continue;
          }

          // A blanket disable suppresses THIS rule too, so a report on its own line would be
          // swallowed by the directive it is about — for the forms that cover their own line.
          // `-next-line` covers only the line BELOW, so shifting there would just point the error
          // at unrelated code. (A blanket disable on line 1 still wins over the shift; the gate
          // in scripts/lint/designSystemLint.mjs catches that one by reading suppressedMessages.)
          const line = comment.loc.start.line;
          const coversOwnLine = directive.kind !== 'eslint-disable-next-line';
          context.report({
            loc: coversOwnLine ? { line: Math.max(1, line - 1), column: 0 } : comment.loc,
            messageId: 'blanketDisable',
            data: {
              line: String(line),
              suggestion: `eslint-disable ${prefix}no-color-literals -- ${REASON_PLACEHOLDER}`,
            },
          });
        }
      },
    };
  },
};
