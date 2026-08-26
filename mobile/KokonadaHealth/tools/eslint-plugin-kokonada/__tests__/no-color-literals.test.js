const path = require('path');
const { RuleTester } = require('eslint');
const rule = require('../lib/rules/no-color-literals');

const tokensPath = path.resolve(__dirname, 'tokens.fixture.txt');
const options = [{ tokensPath }];

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: { ecmaVersion: 2021, sourceType: 'module', ecmaFeatures: { jsx: true } },
});

ruleTester.run('no-color-literals', rule, {
  valid: [
    // The whole point: read the palette instead of writing the value.
    { code: 'const bg = c.surface.base;', options },
    { code: 'const bg = colors.dark.accent.glow;', options },
    // Strings that merely contain letters a-f are not colours.
    { code: "const s = 'deadbeef';", options },
    { code: "const s = 'GeneralSans-Semibold';", options },
    // A '#' that is not a colour: too few digits, too many, or non-hex characters.
    { code: "const s = '#ab';", options },
    { code: "const s = '#abcde';", options },
    { code: "const s = '#zzzzzz';", options },
    // Numbers are the other rule's business.
    { code: 'const n = 16;', options },
    // A template with no colour in it.
    { code: 'const s = `scale(${k})`;', options },
    // Module specifiers are never colours.
    { code: "import { colors } from '../design/tokens';", options },
  ],

  invalid: [
    {
      // The message has to carry BOTH the value and its replacement, or it gets suppressed.
      code: "const bg = '#0E1030';",
      options,
      errors: [{
        message:
          "Colour literal '#0E1030' bypasses the design system — it is dark.surface.base in " +
          'src/design/tokens.ts. Read it from the palette (screens use useTheme()) instead of ' +
          'hardcoding the hex; literal colour is allowed only under src/design/.',
      }],
    },
    {
      // An undeclared colour is the #3A5CCC case: say so, and say what to do about it.
      code: "const bg = '#BADA55';",
      options,
      errors: [{
        message:
          "Colour literal '#BADA55' bypasses the design system, and no token in " +
          'src/design/tokens.ts declares it. Add it to the palette there and read it through ' +
          'useTheme(); literal colour is allowed only under src/design/.',
      }],
    },
    {
      // Case and shorthand must not be a way around the ban or around the token lookup.
      code: "const bg = '#0e1030';",
      options,
      errors: [{ messageId: 'knownColor', data: { value: '#0e1030', token: 'dark.surface.base' } }],
    },
    { code: "const bg = '#fff';", options, errors: [{ messageId: 'unknownColor' }] },
    { code: "const bg = '#ffff';", options, errors: [{ messageId: 'unknownColor' }] },
    { code: "const bg = '#3FB4F014';", options, errors: [{ messageId: 'unknownColor' }] },
    {
      // rgba() with the whitespace a formatter would add still resolves to the token.
      code: "const bg = 'rgba(255, 255, 255, 0.10)';",
      options,
      errors: [{ messageId: 'knownColor', data: { value: 'rgba(255, 255, 255, 0.10)', token: 'dark.aurora.glass.night.bg' } }],
    },
    { code: "const bg = 'rgb(1,2,3)';", options, errors: [{ messageId: 'unknownColor' }] },
    { code: "const bg = 'hsl(200, 50%, 50%)';", options, errors: [{ messageId: 'unknownColor' }] },
    { code: "const bg = 'hsla(200, 50%, 50%, 0.4)';", options, errors: [{ messageId: 'unknownColor' }] },
    {
      // A template literal is the obvious way around a string-literal ban. It is not one.
      code: 'const bg = `rgba(255,255,255,${a})`;',
      options,
      errors: [{ messageId: 'unknownColor' }],
    },
    {
      code: 'const bg = `#${hex}`;',
      options,
      errors: [{ messageId: 'unknownColor' }],
    },
    {
      // Where these actually get written.
      code: "const s = StyleSheet.create({ box: { backgroundColor: '#8B6FE8' } });",
      options,
      errors: [{ messageId: 'knownColor', data: { value: '#8B6FE8', token: 'dark.accent.glow' } }],
    },
    {
      code: "const El = () => <View style={{ borderColor: '#8B6FE8' }} />;",
      options,
      errors: [{ messageId: 'knownColor' }],
    },
    {
      // A JSX string attribute is still a colour literal.
      code: 'const El = () => <Icon color="#8B6FE8" />;',
      options,
      errors: [{ messageId: 'knownColor' }],
    },
    {
      // Two on one line are two errors — a single report per line would let one hide.
      code: "const g = ['#0E1030', '#BADA55'];",
      options,
      errors: [{ messageId: 'knownColor' }, { messageId: 'unknownColor' }],
    },
  ],
});

// RuleTester registers its cases through describe/it, so jest needs a test in the file
// to consider the suite non-empty when every case is filtered out.
test('no-color-literals rule module is well-formed', () => {
  expect(rule.meta.messages.knownColor).toBeDefined();
  expect(rule.meta.messages.unknownColor).toBeDefined();
});
