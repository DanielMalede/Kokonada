'use strict';

// Numbers are NOT banned wholesale — `flex: 1` and `opacity: 0.5` are fine. What is banned is
// a raw number on a property that must come off a scale: spacing, radius, and the type metrics.
// Those are the ones that quietly drift a layout out of rhythm one screen at a time.
// The exemption for the token-defining files is applied in eslint.design-system.js.

const { tokensFor, tokensPathSchema } = require('../resolveTokens');

// Each entry maps a style property to the scale it must read from. `padding*`/`margin*` are
// matched by shape so every RN variant (…Horizontal, …Start, …Block) is covered without a list
// that goes stale; borderRadius likewise covers every corner variant.
const PROPERTY_SCALES = [
  { match: /^padding([A-Z][A-Za-z]*)?$/, scale: 'space', label: 'spacing scale' },
  { match: /^margin([A-Z][A-Za-z]*)?$/, scale: 'space', label: 'spacing scale' },
  { match: /^(gap|rowGap|columnGap)$/, scale: 'space', label: 'spacing scale' },
  { match: /^border([A-Z][A-Za-z]*)?Radius$/, scale: 'radius', label: 'radius scale' },
  { match: /^fontSize$/, scale: 'fontSize', label: 'type scale' },
  { match: /^letterSpacing$/, scale: 'letterSpacing', label: 'letter-spacing scale' },
  // lineHeight is size x leading, not a flat scale — it gets its own message.
  { match: /^lineHeight$/, scale: null, label: 'type scale', kind: 'derivedLineHeight' },
  // The hairline stays StyleSheet.hairlineWidth (resolution-dependent, so not a token); the
  // stroke scale covers the fixed widths — `none`, `control` and `glyph` — across borderWidth
  // and every directional variant.
  { match: /^border([A-Z][A-Za-z]*)?Width$/, scale: 'borderWidth', label: 'border-width scale' },
];

/** The number a node denotes, or null when it is not a plain numeric literal. */
function numericValue(node) {
  if (!node) { return null; }
  if (node.type === 'Literal' && typeof node.value === 'number') { return node.value; }
  if (
    node.type === 'UnaryExpression' &&
    (node.operator === '-' || node.operator === '+') &&
    node.argument.type === 'Literal' &&
    typeof node.argument.value === 'number'
  ) {
    return node.operator === '-' ? -node.argument.value : node.argument.value;
  }
  return null;
}

/**
 * Every numeric literal inside a value that must have come off a scale, tagged with how to
 * describe it: `isOffset` means it is a term ADDED inside an expression, otherwise it is a value
 * the property can actually take.
 *
 * The +/- vs * // split is the core distinction. ADDING a number adds a LENGTH, and lengths come
 * off the scale. MULTIPLYING scales something, so the literal is a dimensionless RATIO — which is
 * exactly how `space.lg * 2` and `size * leading` are meant to be written.
 *
 * The same reasoning applies one level down, and getting it wrong is worse than missing it:
 * in `(items.length - 1) * space.xs` the subtree left of the `*` is a COUNT, not a length, and
 * reporting its `1` produces the advice "use space.none (0)" — which rewrites working code to
 * `(items.length - 0)`. So a scaling operand is only descended into when its sibling is a plain
 * literal ratio, which is what marks the operand itself as the length being scaled.
 */
function offendingLiterals(node, out = []) {
  if (!node || typeof node.type !== 'string') { return out; }

  if (node.type === 'BinaryExpression') {
    const additive = node.operator === '+' || node.operator === '-';
    const sides = [node.left, node.right];
    for (let i = 0; i < 2; i++) {
      const side = sides[i];
      const sibling = sides[1 - i];
      if (numericValue(side) !== null) {
        // Under +/- the literal is a length; under * or / it is a ratio, and legal.
        if (additive) { out.push({ node: side, isOffset: true }); }
        continue;
      }
      if (additive || numericValue(sibling) !== null) { offendingLiterals(side, out); }
    }
    return out;
  }

  if (node.type === 'UnaryExpression') { return offendingLiterals(node.argument, out); }

  // Positions where a literal IS the value the property takes — a ternary branch, a `??`/`||`
  // fallback, a Math.max(inset, N) floor. Not offsets, so they read as plain values.
  const valuePositions =
    node.type === 'ConditionalExpression' ? [node.consequent, node.alternate]
      : node.type === 'LogicalExpression' ? [node.left, node.right]
        : node.type === 'CallExpression' ? node.arguments
          : null;
  if (valuePositions) {
    for (const child of valuePositions) {
      if (numericValue(child) !== null) { out.push({ node: child, isOffset: false }); }
      else { offendingLiterals(child, out); }
    }
  }
  return out;
}

/** The scale step a value should have been written as: { name, value, exact }, or null when
 *  the scale is not declared at all.
 *
 *  Sign is not a simple prefix. `tracking` DECLARES its negatives (display: -0.4), so -0.4 is a
 *  direct hit there; `space` is all-positive, so a negative offset has to be mirrored and read
 *  back as -space.xs. Try the value as written first, then its mirror, and for an off-scale
 *  value keep whichever candidate actually lands closer. */
function resolveStep(tokens, scale, num) {
  const direct = tokens.scaleName(scale, num);
  if (direct) { return { name: direct, value: num, exact: true }; }

  if (num < 0) {
    const mirrored = tokens.scaleName(scale, -num);
    if (mirrored) { return { name: '-' + mirrored, value: num, exact: true }; }
  }

  const near = tokens.nearestScaleStep(scale, num);
  if (!near) { return null; }
  if (num >= 0) { return { name: near.name, value: near.value, exact: false }; }

  const mirror = tokens.nearestScaleStep(scale, -num);
  const useMirror = mirror && Math.abs(-mirror.value - num) < Math.abs(near.value - num);
  return useMirror
    ? { name: '-' + mirror.name, value: -mirror.value, exact: false }
    : { name: near.name, value: near.value, exact: false };
}

function propertyName(node) {
  if (node.computed) { return null; }
  if (node.key.type === 'Identifier') { return node.key.name; }
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') { return node.key.value; }
  return null;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ban raw numbers on scale-bound style properties (padding/margin/gap/radius/type metrics) outside src/design.',
    },
    schema: [tokensPathSchema],
    messages: {
      onScale:
        '{{property}}: {{value}} bypasses the {{scaleLabel}} — use {{token}} from src/design/tokens.ts.',
      offScale:
        '{{property}}: {{value}} bypasses the {{scaleLabel}}, and {{value}} is not on it — the ' +
        'nearest step is {{token}} ({{nearest}}). Use a scale token from src/design/tokens.ts, ' +
        'or add the step there.',
      additiveOnScale:
        '{{property}} adds a bare {{value}} to an expression — use {{token}} from ' +
        'src/design/tokens.ts rather than typing the number.',
      additiveOffScale:
        '{{property}} adds a bare {{value}} to an expression, and {{value}} is not on the ' +
        '{{scaleLabel}} — the nearest step is {{token}} ({{nearest}}). Use a scale token from ' +
        'src/design/tokens.ts, or add the step there.',
      derivedLineHeight:
        '{{property}}: {{value}} bypasses the type scale — derive it, e.g. ' +
        'typography.size.body * typography.leading.normal (src/design/tokens.ts).',
      noScaleDeclared:
        '{{property}}: {{value}} bypasses the design system, and src/design/tokens.ts declares ' +
        'no {{scaleLabel}} — add one there and read it, rather than hardcoding {{value}}.',
    },
  },

  create(context) {
    const tokens = tokensFor(context);

    /** `isOffset` picks the wording: the number is the property's whole value, or a term
     *  added inside a larger expression. Naming that difference keeps the message true. */
    function report(node, property, num, entry, isOffset) {
      const value = String(num);
      const base = { property, value, scaleLabel: entry.label };

      if (entry.kind) {
        context.report({ node, messageId: entry.kind, data: base });
        return;
      }

      const step = resolveStep(tokens, entry.scale, num);
      if (!step) {
        // No scale to point at (tokens file missing or the scale was never declared).
        context.report({ node, messageId: 'noScaleDeclared', data: base });
        return;
      }
      if (step.exact) {
        context.report({
          node,
          messageId: isOffset ? 'additiveOnScale' : 'onScale',
          data: { ...base, token: step.name },
        });
        return;
      }
      context.report({
        node,
        messageId: isOffset ? 'additiveOffScale' : 'offScale',
        data: { ...base, token: step.name, nearest: String(step.value) },
      });
    }

    return {
      Property(node) {
        const property = propertyName(node);
        if (!property) { return; }
        const entry = PROPERTY_SCALES.find((e) => e.match.test(property));
        if (!entry) { return; }
        const direct = numericValue(node.value);
        if (direct !== null) {
          report(node, property, direct, entry, false);
          return;
        }
        // Not a literal itself — but an off-system length can still be hiding inside it.
        for (const hit of offendingLiterals(node.value)) {
          report(hit.node, property, numericValue(hit.node), entry, hit.isOffset);
        }
      },
    };
  },
};
