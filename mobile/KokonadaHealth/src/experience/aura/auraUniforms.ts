// Pure derivation of bio-aura shader uniforms from live heart rate. Runs on the
// UI thread every frame — a single non-finite uniform crashes the Skia surface —
// so every output is clamped and finite. The pulse advances by ELAPSED TIME, not
// frame count, so the aura breathes identically at 60fps or a throttled 30fps.

export interface AuraUniforms {
  hue: number;      // 0..360 — cool (calm) → warm (aroused)
  intensity: number; // 0..1 — glow strength
  pulseHz: number;   // >0..4 — beats per second driving the breathing
}

// Shown when there is no biometric signal at all (no watch, permission revoked).
export const RESTING_AURA: AuraUniforms = { hue: 210, intensity: 0.12, pulseHz: 0.9 };

const HR_MIN = 40;
const HR_MAX = 200;
const MAX_PULSE_HZ = 4; // hard strobe guard
const TWO_PI = 2 * Math.PI;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function deriveAuraUniforms(hr: number | null): AuraUniforms {
  if (hr === null || !Number.isFinite(hr)) return { ...RESTING_AURA };

  const clampedHr = clamp(hr, HR_MIN, HR_MAX);
  const t = (clampedHr - HR_MIN) / (HR_MAX - HR_MIN); // 0..1

  return {
    hue: 210 - t * 210,                       // 210 (cool blue) → 0 (hot red)
    intensity: clamp(0.1 + t * 0.8, 0, 1),
    pulseHz: clamp(clampedHr / 60, 0.1, MAX_PULSE_HZ), // bpm → beats/sec, strobe-capped
  };
}

// Advance the breathing phase by wall-clock time. Non-positive dt is a no-op
// (paused clock); any dt stays finite and wrapped into [0, 2π). The INCOMING phase
// is sanitized too: a single NaN phase (e.g. an uninitialized SharedValue) would
// otherwise propagate NaN every frame and crash the whole Skia surface. (QA4 Q2)
export function advancePulsePhase(phase: number, pulseHz: number, dtMs: number): number {
  const base = Number.isFinite(phase) ? phase : 0;
  if (!(dtMs > 0) || !Number.isFinite(dtMs)) return base;
  const hz = Number.isFinite(pulseHz) ? pulseHz : 0;
  const next = base + TWO_PI * hz * (dtMs / 1000);
  const wrapped = next % TWO_PI;
  return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}
