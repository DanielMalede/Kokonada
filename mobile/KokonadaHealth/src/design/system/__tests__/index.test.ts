import * as system from '../index';

// The barrel is the single public entry point for the shared system-state primitives. Screens
// import from `design/system`, never from the individual files — so this pins that every component
// and named constant is re-exported (and that the constants keep their spec'd values).

describe('design/system barrel', () => {
  it('re-exports all four primitives', () => {
    expect(typeof system.useCalmPulse).toBe('function');
    expect(typeof system.Skeleton).toBe('function');
    expect(typeof system.EmptyState).toBe('function');
    expect(typeof system.OfflineBanner).toBe('function');
  });

  it('re-exports the Skeleton helpers off the component', () => {
    expect(typeof system.Skeleton.Group).toBe('function');
    expect(typeof system.Skeleton.Row).toBe('function');
  });

  it('re-exports the named constants at their spec values', () => {
    expect(system.SKELETON_PULSE).toEqual({ rest: 0.6, peak: 1.0, still: 1.0 });
    expect(system.EMPTY_GLOW_OPACITY).toBe(0.4);
    expect(system.OFFLINE_GRACE_MS).toBe(1400);
    expect(system.BACK_ONLINE_HOLD_MS).toBe(1600);
  });
});
