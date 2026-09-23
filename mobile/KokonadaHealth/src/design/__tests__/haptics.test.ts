import fs from 'fs';
import path from 'path';
import { fireHaptic } from '../haptics';
import { haptics } from '../tokens';

const HAPTIC_MOD = 'react-native-haptic-feedback';

// fireHaptic loads the native module lazily inside a catch-everything, because a haptic is
// non-essential confirmation feedback and must never throw into a render or a tap handler.
// That shape is also a trap: it hides the difference between "no haptics on this device" and
// "haptics are broken everywhere". These tests hold both halves — the swallow, AND the proof
// that the normal path really reaches the native trigger rather than being swallowed too.

describe('fireHaptic — the working path', () => {
  const nativeTrigger = () => (jest.requireMock(HAPTIC_MOD) as { trigger: jest.Mock }).trigger;
  beforeEach(() => { nativeTrigger().mockClear(); });

  // The regression this file exists for: before jest.setup.js stubbed the module, the require
  // threw a SyntaxError, the catch ate it, and fireHaptic was a no-op in EVERY test in the suite
  // while still "passing". Asserting the trigger fires is what makes that impossible to repeat.
  it('reaches the native trigger with the token-mapped effect', () => {
    fireHaptic('selection');
    expect(nativeTrigger()).toHaveBeenCalledWith(haptics.selection);
  });

  it.each(Object.keys(haptics) as Array<keyof typeof haptics>)(
    'fires the curated effect for %s', (key) => {
      fireHaptic(key);
      expect(nativeTrigger()).toHaveBeenCalledWith(haptics[key]);
    },
  );
});

// The chain a haptic actually travels is: call site -> HapticKey -> effect string -> native.
// The two tests below pin the two links that can be verified off-device. The last link —
// the native layer producing a real vibration — is the only part that needs hardware.
describe('the curated vocabulary is real', () => {
  // Loaded by absolute path on purpose: the package's `exports` map blocks the subpath, and
  // requiring the package proper reaches TurboModuleRegistry and throws headlessly. types.js is
  // a pure enum with no native dependency, so this is the INSTALLED library's own list —
  // upgrading to a version that renames an effect fails here rather than on a user's phone.
  const realEffectNames = (): string[] => {
    const pkgDir = path.dirname(require.resolve(`${HAPTIC_MOD}/package.json`));
    const types = jest.requireActual(path.join(pkgDir, 'lib/commonjs/types.js')) as {
      HapticFeedbackTypes: Record<string, string>;
    };
    return Object.values(types.HapticFeedbackTypes);
  };

  it('every haptics token is an effect the installed library actually defines', () => {
    const valid = realEffectNames();
    expect(valid.length).toBeGreaterThan(10); // the list loaded; the check below is not vacuous
    for (const [key, effect] of Object.entries(haptics)) {
      expect({ key, effect, known: valid.includes(effect) })
        .toEqual({ key, effect, known: true });
    }
  });

  // CI runs jest, not tsc, so a mistyped key would ship as `trigger(undefined)` — which the
  // library's default parameter turns into the WRONG effect firing, not silence. This walks the
  // real call sites and holds them to the vocabulary.
  //
  // Both spellings matter: most screens take the haptic as an injectable `triggerHaptic =
  // fireHaptic` prop, so scanning only `fireHaptic(` missed the majority of them.
  it('every haptic call site in the app passes a declared HapticKey', () => {
    const root = path.resolve(__dirname, '../../..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        // Production call sites only — a test may legitimately name a key that does not exist
        // in order to prove it is rejected (this file does exactly that, two lines up).
        const skip = ['__tests__', 'node_modules', 'android', 'ios', 'tools', 'scripts', '.git'];
        if (entry.isDirectory()) { if (!skip.includes(entry.name)) { walk(full); } }
        else if (/\.tsx?$/.test(entry.name)) { files.push(full); }
      }
    };
    walk(root);

    const keys = Object.keys(haptics);
    const calls: Array<{ file: string; key: string }> = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:fireHaptic|triggerHaptic)\(\s*['"]([^'"]*)['"]/g)) {
        calls.push({ file: path.relative(root, file).split(path.sep).join('/'), key: m[1] });
      }
    }

    // A floor just under today's count: if a refactor hides the call sites from this scan, the
    // test must fail rather than quietly pass on an empty set.
    expect(calls.length).toBeGreaterThanOrEqual(15);
    expect(calls.filter((c) => !keys.includes(c.key))).toEqual([]);
  });
});

describe('fireHaptic — never throws, whatever the native side does', () => {
  beforeEach(() => { jest.resetModules(); });
  afterEach(() => { jest.dontMock(HAPTIC_MOD); jest.resetModules(); });

  it('is a silent no-op when the native module is absent entirely', () => {
    jest.doMock(HAPTIC_MOD, () => { throw new Error('module not found'); });
    const fresh = require('../haptics').fireHaptic as typeof fireHaptic;
    expect(() => fresh('selection')).not.toThrow();
  });

  it('is a silent no-op when the module loads but exposes no trigger', () => {
    jest.doMock(HAPTIC_MOD, () => ({}));
    const fresh = require('../haptics').fireHaptic as typeof fireHaptic;
    expect(() => fresh('selection')).not.toThrow();
  });

  it('still never throws when the native trigger itself throws', () => {
    const trigger = jest.fn(() => { throw new Error('native boom'); });
    jest.doMock(HAPTIC_MOD, () => ({ trigger }));
    const fresh = require('../haptics').fireHaptic as typeof fireHaptic;
    expect(() => fresh('commit')).not.toThrow();
    expect(trigger).toHaveBeenCalled();
  });

  it('accepts a module that exposes trigger under a default export', () => {
    const trigger = jest.fn();
    jest.doMock(HAPTIC_MOD, () => ({ default: { trigger } }));
    const fresh = require('../haptics').fireHaptic as typeof fireHaptic;
    fresh('success');
    expect(trigger).toHaveBeenCalledWith(haptics.success);
  });
});
