const { Linter } = require('eslint');
const plugin = require('..');

// Driven through Linter with the whole plugin registered, not RuleTester: the code under test
// CONTAINS `kokonada/...` disable directives, and ESLint reports an unknown rule name in a
// directive as its own error. Registering the real plugin also means these cases exercise the
// actual wiring — including ESLint applying the very directives the rule is complaining about.
const linter = new Linter();
for (const name of Object.keys(plugin.rules)) {
  linter.defineRule('kokonada/' + name, plugin.rules[name]);
}

const RULE = 'kokonada/require-disable-reason';

function report(code) {
  return linter
    .verify(code, {
      parserOptions: { ecmaVersion: 2021, sourceType: 'module' },
      rules: { [RULE]: 'error' },
    })
    .filter((m) => m.ruleId === RULE);
}

const REASON = '<why the token system cannot express this>';

describe('lets a reasoned disable through', () => {
  const accepted = {
    'no directives at all': 'const a = 1;',
    'next-line with a reason':
      "// eslint-disable-next-line kokonada/no-color-literals -- brand asset ships a raw hex\nconst a = '#BADA55';",
    'same-line with a reason':
      "const a = '#BADA55'; // eslint-disable-line kokonada/no-color-literals -- vendor SDK contract",
    'block disable with a reason': '/* eslint-disable kokonada/no-scale-literals -- generated layout table */',
    'a reasoned blanket disable is still reasoned': 'const a = 1;\n/* eslint-disable -- whole file is generated */',
    'a comment that only MENTIONS the rule is not a directive':
      '// see kokonada/no-color-literals for why this is a token\nconst a = 1;',
    'eslint-enable is not a suppression': '/* eslint-enable kokonada/no-color-literals */',
  };
  for (const label of Object.keys(accepted)) {
    it(label, () => expect(report(accepted[label])).toEqual([]));
  }
});

describe('leaves unrelated pre-existing disables alone', () => {
  // This rule is the design-system escape hatch, not a repo-wide policy. Turning every bare
  // disable in the codebase into an error is a separate change with a separate blast radius.
  const untouched = {
    'a bare react-hooks disable': '// eslint-disable-next-line react-hooks/exhaustive-deps\nconst a = 1;',
    'a bare no-void disable': 'const a = 1; // eslint-disable-line no-void',
    'a bare block disable of another rule': '/* eslint-disable no-shadow */',
  };
  for (const label of Object.keys(untouched)) {
    it(label, () => expect(report(untouched[label])).toEqual([]));
  }
});

describe('rejects a bare disable of a design-system rule', () => {
  it('names the rule and spells out the comment that would be accepted', () => {
    const messages = report("// eslint-disable-next-line kokonada/no-color-literals\nconst a = '#BADA55';");
    expect(messages).toHaveLength(1);
    expect(messages[0].line).toBe(1);
    expect(messages[0].message).toBe(
      'This disable has no reason. A design-system rule may only be suppressed with a written ' +
      "reason on the same line — write 'eslint-disable-next-line kokonada/no-color-literals -- " +
      REASON + "'. A bare disable comment is itself a lint error.",
    );
  });

  const rejected = {
    'same-line form': "const a = '#BADA55'; // eslint-disable-line kokonada/no-color-literals",
    'block form': '/* eslint-disable kokonada/no-scale-literals */',
    'a separator with nothing after it is not a reason':
      '// eslint-disable-next-line kokonada/no-color-literals --\nconst a = 1;',
    'one design-system rule in a list is enough':
      '// eslint-disable-next-line no-void, kokonada/no-color-literals\nconst a = 1;',
  };
  for (const label of Object.keys(rejected)) {
    it(label, () => {
      const messages = report(rejected[label]);
      expect(messages).toHaveLength(1);
      expect(messages[0].messageId).toBe('missingReason');
    });
  }
});

describe('rejects a bare BLANKET disable, which would otherwise silence this rule too', () => {
  it('reports on the line above and names the real line', () => {
    const messages = report('const a = 1;\n/* eslint-disable */');
    expect(messages).toHaveLength(1);
    expect(messages[0].line).toBe(1);
    expect(messages[0].message).toBe(
      'The blanket disable on line 2 turns off every rule, including the design-system rules, ' +
      "and carries no reason. Name the rules and give a reason on the same line — 'eslint-disable " +
      'kokonada/no-color-literals -- ' + REASON + "'. A bare disable comment is itself a lint error.",
    );
  });

  it('survives a blanket eslint-disable-line, which disables its own whole line', () => {
    const messages = report('const a = 1;\nconst b = 2; // eslint-disable-line');
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('blanketDisable');
    expect(messages[0].line).toBe(1);
  });

  // Deliberately NOT on line 1: `-next-line` suppresses only the line below, so this form needs
  // no escape shift, and reporting it on the line above would point at unrelated code. On line 1
  // the shifted and unshifted implementations both report line 1, so the test could not tell a
  // fixed rule from a broken one — the whole point of the case.
  it('catches a blanket eslint-disable-next-line, and reports it ON its own line', () => {
    const messages = report('const a = 1;\n// eslint-disable-next-line\nconst b = 2;');
    expect(messages).toHaveLength(1);
    expect(messages[0].messageId).toBe('blanketDisable');
    expect(messages[0].line).toBe(2);
  });
});

test('rule module is well-formed', () => {
  expect(Object.keys(plugin.rules['require-disable-reason'].meta.messages).sort())
    .toEqual(['blanketDisable', 'missingReason']);
});
