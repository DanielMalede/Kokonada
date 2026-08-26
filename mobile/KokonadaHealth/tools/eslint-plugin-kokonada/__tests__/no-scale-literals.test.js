const path = require('path');
const { RuleTester } = require('eslint');
const rule = require('../lib/rules/no-scale-literals');

const tokensPath = path.resolve(__dirname, 'tokens.fixture.txt');
const options = [{ tokensPath }];

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: { ecmaVersion: 2021, sourceType: 'module', ecmaFeatures: { jsx: true } },
});

/** An expected on-scale error. Spelled out so each case asserts the TOKEN it names,
 *  which is the part of the message that decides whether the error gets fixed. */
const onScale = (property, value, token, scaleLabel = 'spacing scale') => ({
  messageId: 'onScale',
  data: { property, value, token, scaleLabel },
});

ruleTester.run('no-scale-literals', rule, {
  valid: [
    // Numbers are NOT banned wholesale — only for the properties that must come from a scale.
    { code: 'const s = { flex: 1 };', options },
    { code: 'const s = { opacity: 0.5 };', options },
    { code: 'const s = { width: 40, height: 40 };', options },
    { code: 'const s = { zIndex: 2 };', options },
    { code: 'const s = { shadowRadius: 12 };', options },
    // The hairline is a PLATFORM value, not a token — it must never be flagged.
    { code: 'const s = { borderWidth: StyleSheet.hairlineWidth };', options },
    { code: 'const s = { borderTopWidth: StyleSheet.hairlineWidth };', options },
    // The properties that ARE covered, done correctly.
    { code: 'const s = { padding: space.lg };', options },
    { code: 'const s = { gap: space.sm };', options },
    { code: 'const s = { borderRadius: radius.md };', options },
    { code: 'const s = { fontSize: typography.size.body };', options },
    // Arithmetic ON the scale is how a half-step or a derived line-height is meant to be written.
    // Multiplying/dividing a token SCALES it; the literal is a ratio, not a length.
    { code: 'const s = { padding: space.lg * 2 };', options },
    { code: 'const s = { padding: space.lg / 2 };', options },
    { code: 'const s = { lineHeight: typography.size.body * typography.leading.normal };', options },
    { code: 'const s = { paddingBottom: insets.bottom + space.lg };', options },
    { code: 'const s = { paddingBottom: insets.bottom + space.lg * 2 };', options },
    // Below a * or /, the subtree is a RATIO and its literals are dimensionless. Reporting them
    // does not just add noise, it gives WRONG advice: "(items.length - 1)" is not a length, and
    // "use space.none (0)" would rewrite it to "(items.length - 0)".
    { code: 'const s = { gap: (items.length - 1) * space.xs };', options },
    { code: 'const s = { fontSize: base * (1 - t) };', options },
    { code: 'const s = { marginLeft: (columns - 1) * gutter };', options },
    { code: 'const s = { paddingHorizontal: space.md * (n - 1) };', options },
    // Shorthand and destructuring defaults are not style values.
    { code: 'const s = { padding };', options },
    { code: 'const { padding = 16 } = props;', options },
    // A computed key cannot be resolved statically, so it is not this rule's business.
    { code: 'const s = { [key]: 16 };', options },
    // An interface member is a type, not a value.
    { code: 'interface S { padding: number }', options },
  ],

  invalid: [
    {
      // The exact-match message names the value and the token that replaces it.
      code: 'const s = { padding: 16 };',
      options,
      errors: [{
        message: 'padding: 16 bypasses the spacing scale — use space.lg from src/design/tokens.ts.',
      }],
    },
    {
      // Off-scale is the more interesting case: say it is off-scale, and name the nearest step.
      code: 'const s = { paddingHorizontal: 15 };',
      options,
      errors: [{
        message:
          'paddingHorizontal: 15 bypasses the spacing scale, and 15 is not on it — the nearest ' +
          'step is space.lg (16). Use a scale token from src/design/tokens.ts, or add the step there.',
      }],
    },
    // Zero is on the scale and has a token, so it is named rather than waved through.
    { code: 'const s = { margin: 0 };', options, errors: [onScale('margin', '0', 'space.none')] },
    // A negative offset resolves against the same scale, keeping its sign.
    { code: 'const s = { marginTop: -4 };', options, errors: [onScale('marginTop', '-4', '-space.xs')] },
    { code: 'const s = { marginHorizontal: 24 };', options, errors: [onScale('marginHorizontal', '24', 'space.xl')] },
    { code: 'const s = { gap: 8 };', options, errors: [onScale('gap', '8', 'space.sm')] },
    // A step whose key is not a bare identifier has to be named in bracket form.
    { code: 'const s = { rowGap: 32 };', options, errors: [onScale('rowGap', '32', "space['2xl']")] },
    { code: 'const s = { columnGap: 12 };', options, errors: [onScale('columnGap', '12', 'space.md')] },
    // borderRadius and every corner variant read the radius scale.
    { code: 'const s = { borderRadius: 14 };', options, errors: [onScale('borderRadius', '14', 'radius.md', 'radius scale')] },
    { code: 'const s = { borderTopLeftRadius: 10 };', options, errors: [onScale('borderTopLeftRadius', '10', 'radius.sm', 'radius scale')] },
    { code: 'const s = { borderBottomEndRadius: 999 };', options, errors: [onScale('borderBottomEndRadius', '999', 'radius.pill', 'radius scale')] },
    { code: 'const s = { fontSize: 11 };', options, errors: [onScale('fontSize', '11', 'typography.size.caption', 'type scale')] },
    // tracking DECLARES its negative steps (display: -0.4), so -0.4 is an exact hit and must
    // not be reported as "-typography.tracking.display" — the scale already carries the sign.
    {
      code: 'const s = { letterSpacing: -0.4 };',
      options,
      errors: [onScale('letterSpacing', '-0.4', 'typography.tracking.display', 'letter-spacing scale')],
    },
    {
      // Off-scale on a scale that HAS negative steps: the nearest step is the negative one.
      code: 'const s = { letterSpacing: -0.35 };',
      options,
      errors: [{
        message:
          'letterSpacing: -0.35 bypasses the letter-spacing scale, and -0.35 is not on it — the ' +
          'nearest step is typography.tracking.display (-0.4). Use a scale token from ' +
          'src/design/tokens.ts, or add the step there.',
      }],
    },
    {
      // Off-scale negative on an all-positive scale: mirror it, and keep the sign in both halves.
      code: 'const s = { marginTop: -5 };',
      options,
      errors: [{
        message:
          'marginTop: -5 bypasses the spacing scale, and -5 is not on it — the nearest step is ' +
          '-space.xs (-4). Use a scale token from src/design/tokens.ts, or add the step there.',
      }],
    },
    {
      // lineHeight has no flat scale — it is size x leading, and the message must say so.
      code: 'const s = { lineHeight: 22 };',
      options,
      errors: [{
        message:
          'lineHeight: 22 bypasses the type scale — derive it, e.g. ' +
          'typography.size.body * typography.leading.normal (src/design/tokens.ts).',
      }],
    },
    {
      // borderWidth reads the stroke scale: `control` outlines a pill, `glyph` draws a mark.
      code: 'const s = { borderWidth: 1.5 };',
      options,
      errors: [{
        message:
          'borderWidth: 1.5 bypasses the border-width scale — use stroke.control from ' +
          'src/design/tokens.ts.',
      }],
    },
    { code: 'const s = { borderWidth: 2.5 };', options, errors: [onScale('borderWidth', '2.5', 'stroke.glyph', 'border-width scale')] },
    // Directional widths are the form RN code actually uses, and are covered the same way
    // borderRadius covers its corner variants.
    { code: 'const s = { borderTopWidth: 1.5 };', options, errors: [onScale('borderTopWidth', '1.5', 'stroke.control', 'border-width scale')] },
    { code: 'const s = { borderBottomWidth: 0 };', options, errors: [onScale('borderBottomWidth', '0', 'stroke.none', 'border-width scale')] },
    { code: 'const s = { borderStartWidth: 2.5 };', options, errors: [onScale('borderStartWidth', '2.5', 'stroke.glyph', 'border-width scale')] },
    {
      // Off-scale still names the nearest stroke rather than shrugging.
      code: 'const s = { borderWidth: 3 };',
      options,
      errors: [{
        message:
          'borderWidth: 3 bypasses the border-width scale, and 3 is not on it — the nearest step ' +
          'is stroke.glyph (2.5). Use a scale token from src/design/tokens.ts, or add the step there.',
      }],
    },
    {
      // Degradation path: with no tokens file to read, the rule still reports — it just cannot
      // name a token. It must never fall silent, and never crash the lint run.
      code: 'const s = { padding: 16 };',
      options: [{ tokensPath: 'no-such-tokens-file.ts' }],
      errors: [{
        message:
          'padding: 16 bypasses the design system, and src/design/tokens.ts declares no ' +
          'spacing scale — add one there and read it, rather than hardcoding 16.',
      }],
    },
    // Where these are actually written.
    {
      code: 'const s = StyleSheet.create({ card: { padding: 16, borderRadius: 14 } });',
      options,
      errors: [
        onScale('padding', '16', 'space.lg'),
        onScale('borderRadius', '14', 'radius.md', 'radius scale'),
      ],
    },
    {
      code: 'const El = () => <View style={{ marginBottom: 24 }} />;',
      options,
      errors: [onScale('marginBottom', '24', 'space.xl')],
    },
    {
      // THE most common safe-area idiom in RN, and it walked straight through the rule before:
      // the value is a BinaryExpression, so a literal-only check never looked inside it.
      code: 'const s = { paddingBottom: insets.bottom + 16 };',
      options,
      errors: [{
        message:
          'paddingBottom adds a bare 16 to an expression — use space.lg from src/design/tokens.ts ' +
          'rather than typing the number.',
      }],
    },
    {
      code: 'const s = { paddingBottom: insets.bottom + 15 };',
      options,
      errors: [{
        message:
          'paddingBottom adds a bare 15 to an expression, and 15 is not on the spacing scale — the ' +
          'nearest step is space.lg (16). Use a scale token from src/design/tokens.ts, or add the ' +
          'step there.',
      }],
    },
    // Subtraction is the same offset in the other direction.
    { code: 'const s = { marginTop: headerHeight - 8 };', options, errors: [{ messageId: 'additiveOnScale' }] },
    // Scaling a real LENGTH by a literal ratio: the length's own offset is still an offset.
    // This is the case the sibling rule above must not throw away.
    { code: 'const s = { padding: (insets.top + 4) * 2 };', options, errors: [{ messageId: 'additiveOnScale' }] },
    // Value positions — the literal is what the property becomes, so it reads as a plain value,
    // not as "adds a bare N". All three were silent before.
    {
      code: 'const s = { padding: compact ? 8 : 16 };',
      options,
      errors: [onScale('padding', '8', 'space.sm'), onScale('padding', '16', 'space.lg')],
    },
    { code: 'const s = { paddingTop: pad ?? 16 };', options, errors: [onScale('paddingTop', '16', 'space.lg')] },
    { code: 'const s = { paddingTop: insets.top || 12 };', options, errors: [onScale('paddingTop', '12', 'space.md')] },
    {
      // Math.max(inset, N) is the other half of the safe-area idiom.
      code: 'const s = { paddingBottom: Math.max(insets.bottom, 16) };',
      options,
      errors: [onScale('paddingBottom', '16', 'space.lg')],
    },
    // Two bare offsets are two separate errors — reporting once would hide one.
    { code: 'const s = { padding: 4 + gutter + 8 };', options, errors: [{ messageId: 'additiveOnScale' }, { messageId: 'additiveOnScale' }] },
    // A covered property is a covered property, whichever scale it reads.
    { code: 'const s = { borderRadius: base + 14 };', options, errors: [{ messageId: 'additiveOnScale' }] },
    { code: 'const s = { fontSize: base + 11 };', options, errors: [{ messageId: 'additiveOnScale' }] },
    {
      // A string key is the same property.
      code: "const s = { 'padding': 16 };",
      options,
      errors: [onScale('padding', '16', 'space.lg')],
    },
  ],
});

test('no-scale-literals rule module is well-formed', () => {
  expect(Object.keys(rule.meta.messages).sort()).toEqual(
    ['additiveOffScale', 'additiveOnScale', 'derivedLineHeight', 'noScaleDeclared', 'offScale', 'onScale'],
  );
});
