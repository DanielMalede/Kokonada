import path from 'node:path';

// eslint ships no type declarations and @types/eslint is not installed. This test needs exactly
// one method, so it takes a local shape rather than adding a types-only dependency to a change
// whose entire point is removing dependencies nothing uses.
type ConfigProbe = { calculateConfigForFile(file: string): Promise<{ rules?: Record<string, unknown> }> };
const { ESLint } = require('eslint') as { ESLint: new (opts: { cwd: string }) => ConfigProbe };

// The gate's blast radius is decided entirely by two globs in eslint.design-system.js, and
// nothing else in the repo pins them. A one-character edit — `src/design/*.ts` widened back to
// `src/design/**`, or APP_SOURCE narrowed — silently switches the rules off across whole
// directories, and every other test in the suite still passes: the ratchet would simply
// re-baseline to the smaller number and CI would stay green while enforcing nothing.
//
// So this asserts the SCOPE itself, by asking ESLint what config it would actually apply.

const APP_ROOT = path.resolve(__dirname, '../../..');
const RULES = ['kokonada/no-color-literals', 'kokonada/no-scale-literals'] as const;

/** Severity ESLint would really use for `rule` on `file`. 0 = off, 2 = error. */
async function severityFor(file: string, rule: string): Promise<number> {
  const config = await new ESLint({ cwd: APP_ROOT }).calculateConfigForFile(file);
  const entry = (config.rules || {})[rule];
  if (entry === undefined) { return 0; }
  const raw = Array.isArray(entry) ? entry[0] : entry;
  return typeof raw === 'string' ? { off: 0, warn: 1, error: 2 }[raw] ?? 0 : Number(raw);
}

describe('design-system rule scope', () => {
  // A screen is the whole point of the rules.
  it.each(RULES)('%s is an ERROR on a screen', async (rule) => {
    expect(await severityFor('src/experience/profile/ProfileScreen.tsx', rule)).toBe(2);
  });

  it.each(RULES)('%s is an ERROR on a test under src/**', async (rule) => {
    expect(await severityFor('src/navigation/__tests__/TabIcon.test.tsx', rule)).toBe(2);
  });

  // The exemption covers files that DEFINE the system, not everything filed near them.
  it.each(RULES)('%s is OFF in the token source itself', async (rule) => {
    expect(await severityFor('src/design/tokens.ts', rule)).toBe(0);
  });

  it.each(RULES)('%s is OFF in a pure design module beside the tokens', async (rule) => {
    expect(await severityFor('src/design/emotionAccent.ts', rule)).toBe(0);
  });

  // The token tests ARE the specification — `expect(...).toBe('#A7A6D0')` pins the palette.
  // Banning hex there would ban the lock on the values the rest of the rule defends.
  it.each(RULES)('%s is OFF in the tests that pin the token values', async (rule) => {
    expect(await severityFor('src/design/__tests__/tokens.test.ts', rule)).toBe(0);
    expect(await severityFor('src/design/__tests__/emotionAccent.contrast.test.ts', rule)).toBe(0);
  });

  // These are UI components. They consume the palette exactly like a screen does, and exempting
  // them is how three off-system border widths came to live in the one directory where the rule
  // was off. If this flips back to 0, the exemption has been widened again.
  it.each(RULES)('%s is an ERROR in src/design/system (a component, not a token)', async (rule) => {
    expect(await severityFor('src/design/system/EmptyState.tsx', rule)).toBe(2);
  });

  it.each(RULES)('%s is an ERROR in src/design/components', async (rule) => {
    expect(await severityFor('src/design/components/DiscoveryBadge.tsx', rule)).toBe(2);
  });

  // Build tooling and the plugin's own fixtures are not app styling, and the plugin's tests must
  // be free to contain colour literals — they are what the rules are tested against.
  it.each(RULES)('%s is OFF outside src/ (the lint plugin, build scripts)', async (rule) => {
    expect(await severityFor('tools/eslint-plugin-kokonada/__tests__/no-color-literals.test.js', rule)).toBe(0);
    expect(await severityFor('scripts/brand/buildBrandSvg.mjs', rule)).toBe(0);
  });

  // The escape-hatch rule has to be live wherever the other two are, or a bare disable in a
  // screen would go unreported.
  it('require-disable-reason is an ERROR on a screen', async () => {
    expect(await severityFor('src/experience/profile/ProfileScreen.tsx', 'kokonada/require-disable-reason')).toBe(2);
  });
});
