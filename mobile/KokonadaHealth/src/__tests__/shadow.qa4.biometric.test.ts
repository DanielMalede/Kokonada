// ─────────────────────────────────────────────────────────────────────────────
// QA4 — AGENT Q1: BIOMETRIC VALIDATION (mobile surface)
// Warm-lane HR plausibility gate, the bio-aura HR→uniform derivation (a single
// non-finite uniform crashes the Skia surface), and the foreground state-corruption
// bug where a no-op permission re-confirmation wiped a live HR.
// ─────────────────────────────────────────────────────────────────────────────

import { createWarmStore } from '../state/warm/warmStore';
import { deriveAuraUniforms } from '../experience/aura/auraUniforms';

describe('Q1 — warm HR plausibility gate boundary matrix (30–220)', () => {
  it.each([
    [29, null], [30, 30], [31, 31], [89, 89], [90, 90],
    [119, 119], [120, 120], [219, 219], [220, 220], [221, null],
  ])('hr=%p resolves to %p (null = rejected, keeps last good)', (hr, expected) => {
    const s = createWarmStore();
    s.getState().setLiveHr(hr as number);
    expect(s.getState().liveHr).toBe(expected);
  });

  it('cross-check: the warm gate (30–220) is WIDER than the aura render clamp (40–200)', () => {
    // Documented, intentional: the warm store accepts a physiological range and the
    // aura clamps to a visually pleasant band. A 35 bpm reading is stored but drawn
    // at the aura floor — neither layer produces a non-finite value.
    const s = createWarmStore();
    s.getState().setLiveHr(35);
    expect(s.getState().liveHr).toBe(35);
    const u = deriveAuraUniforms(35);
    expect(Number.isFinite(u.hue) && Number.isFinite(u.intensity) && Number.isFinite(u.pulseHz)).toBe(true);
  });
});

describe('Q1 — bio-aura HR sweep (no uniform may be non-finite or un-clamped)', () => {
  it.each([null, undefined, NaN, Infinity, -Infinity, -1, 0, 29, 40, 200, 300, 9999, 1e308])(
    'hr=%p yields finite, clamped uniforms',
    (hr) => {
      const u = deriveAuraUniforms(hr as any);
      expect(Number.isFinite(u.hue)).toBe(true);
      expect(u.hue).toBeGreaterThanOrEqual(0);
      expect(u.hue).toBeLessThanOrEqual(360);
      expect(u.intensity).toBeGreaterThanOrEqual(0);
      expect(u.intensity).toBeLessThanOrEqual(1);
      expect(u.pulseHz).toBeGreaterThanOrEqual(0.1);
      expect(u.pulseHz).toBeLessThanOrEqual(4); // hard strobe cap
    },
  );
});

describe('Q1 — foreground state corruption: a no-op permission re-confirm must NOT wipe a live HR', () => {
  it('re-reporting already-granted permissions keeps the current HR (foreground reconcile fires this every activation)', () => {
    const s = createWarmStore();
    s.getState().setPermissions({ bluetooth: 'granted', health: 'granted' });
    s.getState().setBiometricSource('ble');
    s.getState().setLiveHr(88);
    // AppState 'active' → reconcileOnForeground → setPermissions({granted,granted}) again.
    s.getState().setPermissions({ bluetooth: 'granted', health: 'granted' });
    expect(s.getState().liveHr).toBe(88);          // NOT wiped to null
    expect(s.getState().biometricSource).toBe('ble');
  });

  it('still severs (drops HR) when a permission is genuinely revoked', () => {
    const s = createWarmStore();
    s.getState().setPermissions({ bluetooth: 'granted', health: 'granted' });
    s.getState().setBiometricSource('ble');
    s.getState().setLiveHr(88);
    s.getState().setPermissions({ bluetooth: 'denied', health: 'granted' });
    expect(s.getState().liveHr).toBeNull();
    expect(s.getState().biometricSource).toBe('none');
  });

  it('still requires a fresh reading after recovering from a severed state', () => {
    const s = createWarmStore();
    s.getState().setPermissions({ bluetooth: 'granted', health: 'granted' });
    s.getState().setLiveHr(100);
    s.getState().setPermissions({ bluetooth: 'denied', health: 'granted' }); // severed → HR null
    s.getState().setPermissions({ bluetooth: 'granted', health: 'granted' }); // recovered
    expect(s.getState().liveHr).toBeNull(); // must arrive fresh, not resurrect stale
  });
});
