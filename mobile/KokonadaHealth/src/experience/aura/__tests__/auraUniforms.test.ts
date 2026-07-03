// The bio-aura is a Skia shader whose uniforms breathe with the user's live heart
// rate (warm lane). The uniform DERIVATION is pure and must be bulletproof: the
// shader runs on the UI thread at 60fps and a single NaN/Infinity uniform crashes
// the whole Skia surface. Erratic HR spikes must be clamped, a missing HR must
// yield a calm resting default, and the pulse must advance by ELAPSED TIME so it
// looks identical whether the device renders at 60fps or throttles to 30fps
// (attack #1).

import { deriveAuraUniforms, advancePulsePhase, RESTING_AURA } from '../auraUniforms';

describe('deriveAuraUniforms — HR → shader params', () => {
  it('a null HR (no biometrics) yields the calm resting aura', () => {
    expect(deriveAuraUniforms(null)).toEqual(RESTING_AURA);
  });

  it('maps a resting HR to a low-intensity, slow pulse', () => {
    const u = deriveAuraUniforms(60);
    expect(u.intensity).toBeGreaterThanOrEqual(0);
    expect(u.intensity).toBeLessThan(0.4);
    expect(u.pulseHz).toBeCloseTo(1.0, 1); // ~1 beat/sec at 60bpm
  });

  it('maps an elevated HR to higher intensity and a faster pulse', () => {
    const rest = deriveAuraUniforms(60);
    const high = deriveAuraUniforms(150);
    expect(high.intensity).toBeGreaterThan(rest.intensity);
    expect(high.pulseHz).toBeGreaterThan(rest.pulseHz);
  });

  it('CLAMPS an absurd HR spike — every uniform stays finite and in range', () => {
    for (const spike of [0, -50, 300, 9999, 1e9]) {
      const u = deriveAuraUniforms(spike);
      expect(Number.isFinite(u.hue)).toBe(true);
      expect(u.intensity).toBeGreaterThanOrEqual(0);
      expect(u.intensity).toBeLessThanOrEqual(1);
      expect(u.pulseHz).toBeGreaterThan(0);
      expect(u.pulseHz).toBeLessThanOrEqual(4); // never a strobe
    }
  });

  it('NaN / Infinity HR falls back to the resting aura, never a NaN uniform', () => {
    expect(deriveAuraUniforms(NaN)).toEqual(RESTING_AURA);
    expect(deriveAuraUniforms(Infinity)).toEqual(RESTING_AURA);
  });

  it('hue shifts from calm (cool) toward hot as HR rises but stays a valid 0..360', () => {
    for (const hr of [50, 80, 110, 140, 180]) {
      const u = deriveAuraUniforms(hr);
      expect(u.hue).toBeGreaterThanOrEqual(0);
      expect(u.hue).toBeLessThanOrEqual(360);
    }
  });
});

describe('advancePulsePhase — frame-rate-independent breathing', () => {
  it('wraps the phase in [0, 2π)', () => {
    const p = advancePulsePhase(6.0, 1.0, 500); // 0.5s at 1Hz → +π
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(2 * Math.PI);
  });

  it('advances the same total phase in one big step as in many small steps', () => {
    const hz = 1.2;
    const coarse = advancePulsePhase(0, hz, 100); // one 100ms frame (10fps)
    let fine = 0;
    for (let i = 0; i < 10; i++) fine = advancePulsePhase(fine, hz, 10); // ten 10ms frames
    expect(coarse).toBeCloseTo(fine, 5); // identical wall-clock breathing at any fps
  });

  it('a zero or negative dt does not move the phase (paused-clock guard)', () => {
    expect(advancePulsePhase(1.5, 1.0, 0)).toBe(1.5);
    expect(advancePulsePhase(1.5, 1.0, -20)).toBe(1.5);
  });

  it('a huge dropped-frame dt never produces a NaN or non-finite phase', () => {
    const p = advancePulsePhase(0, 2.0, 5_000_000);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(2 * Math.PI);
  });
});
