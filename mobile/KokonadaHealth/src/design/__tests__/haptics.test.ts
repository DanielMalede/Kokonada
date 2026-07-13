import { fireHaptic } from '../haptics';

// A curated haptic is non-essential feedback: the native module may be absent (tests, unsupported
// device), so firing one must be a silent no-op that NEVER throws into a render/tap handler.
describe('fireHaptic', () => {
  it('never throws for a curated key (native module absent → silent no-op)', () => {
    expect(() => fireHaptic('selection')).not.toThrow();
    expect(() => fireHaptic('commit')).not.toThrow();
  });
});
