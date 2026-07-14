import { fireHaptic } from '../haptics';
import { haptics } from '../tokens';

// A curated haptic is non-essential feedback: the native module may be absent (tests, unsupported
// device), so firing one must be a silent no-op that NEVER throws into a render/tap handler.
describe('fireHaptic', () => {
  it('never throws for a curated key (native module absent → silent no-op)', () => {
    expect(() => fireHaptic('selection')).not.toThrow();
    expect(() => fireHaptic('commit')).not.toThrow();
  });
});

// V3: the present-module path — when the native haptic module IS available, fireHaptic drives its
// trigger with the token-mapped effect, and a throwing native trigger is still swallowed.
describe('fireHaptic — native module present', () => {
  const HAPTIC_MOD = 'react-native-haptic-feedback';
  beforeEach(() => { jest.resetModules(); }); // clear the cache so the doMock takes effect
  afterEach(() => { jest.dontMock(HAPTIC_MOD); jest.resetModules(); });

  it('invokes the native trigger with the token-mapped effect', () => {
    const trigger = jest.fn();
    jest.doMock(HAPTIC_MOD, () => ({ trigger }));
    const fresh = require('../haptics').fireHaptic as typeof fireHaptic;
    fresh('selection');
    expect(trigger).toHaveBeenCalledWith(haptics.selection); // 'selection' → the curated effect
  });

  it('still never throws when the present native trigger itself throws', () => {
    const trigger = jest.fn(() => { throw new Error('native boom'); });
    jest.doMock(HAPTIC_MOD, () => ({ trigger }));
    const fresh = require('../haptics').fireHaptic as typeof fireHaptic;
    expect(() => fresh('commit')).not.toThrow();
    expect(trigger).toHaveBeenCalled();
  });
});
