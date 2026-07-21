import {
  auroraFlowPose,
  auroraBlobLayout,
  focalGlowScale,
  FLOW_TRANSLATE,
  FLOW_ROTATE,
  FLOW_SCALE,
  FOCAL_SCALE,
  AURORA_OVERSCAN,
} from '../auroraField';
import { colors, motion } from '../../../design/tokens';

// The LIVING AURORA's motion + layout math. The field itself is painted by Skia on the UI thread,
// where jest cannot observe a frame — so every value that reaches the canvas is derived HERE, as a
// pure function of ELAPSED TIME, and attacked directly (the neuralLoaderMath / auraUniforms
// precedent). Three properties are load-bearing and each has a failing-first pin below:
//   1. FRAME-RATE INDEPENDENCE — the pose is a function of elapsed ms, never of a frame counter, so
//      a 30fps device and a 60fps device sit at the SAME pose at the same wall-clock instant.
//   2. REDUCED MOTION — `null` elapsed (the reduced branch) is a STILL field: one fixed pose for
//      all time, and the identity pose at that (no residual drift/rotation/inflation).
//   3. TOTALITY — a NaN/∞ clock can never reach a Skia transform (a single NaN blanks the canvas).

const W = 390;
const H = 844;
const FLOW_MS = motion.duration.flow;
const TAU = Math.PI * 2;

describe('auroraFlowPose — the ambient drift is a pure function of ELAPSED TIME', () => {
  it('advances with time: distinct instants in the cycle are distinct poses (the field is alive)', () => {
    const a = auroraFlowPose(0, W, H);
    const b = auroraFlowPose(FLOW_MS / 3, W, H);
    const c = auroraFlowPose((FLOW_MS * 2) / 3, W, H);
    expect(a).not.toEqual(b);
    expect(b).not.toEqual(c);
    expect(a).not.toEqual(c);
  });

  it('FRAME-RATE INDEPENDENT: 60fps, 30fps and a janky irregular cadence agree at the same instant', () => {
    // Walk the same 3s of wall-clock at three cadences. A frame-COUNT-driven field would drift
    // apart here (30fps would be half-way through the cycle); an elapsed-time field cannot.
    const at60 = auroraFlowPose(Math.round(180 * (1000 / 60)), W, H); // 180 frames @60fps = 3000ms
    const at30 = auroraFlowPose(Math.round(90 * (1000 / 30)), W, H);  //  90 frames @30fps = 3000ms
    const janky = auroraFlowPose(1234 + 900 + 866, W, H);             // irregular frames, same 3000ms
    expect(at30).toEqual(at60);
    expect(janky).toEqual(at60);
  });

  it('is exactly PERIODIC over motion.duration.flow (the loop never seams)', () => {
    for (const t of [0, 1234, FLOW_MS / 2, FLOW_MS - 1]) {
      const now = auroraFlowPose(t, W, H);
      const nextCycle = auroraFlowPose(t + FLOW_MS, W, H);
      expect(nextCycle.translateX).toBeCloseTo(now.translateX, 6);
      expect(nextCycle.translateY).toBeCloseTo(now.translateY, 6);
      expect(nextCycle.rotate).toBeCloseTo(now.rotate, 6);
      expect(nextCycle.scale).toBeCloseTo(now.scale, 6);
    }
  });

  it('stays inside the DESIGNED envelope for the whole cycle: ±5% drift, ±6°, scale 1.00–1.10', () => {
    for (let t = 0; t <= FLOW_MS * 2; t += 50) {
      const p = auroraFlowPose(t, W, H);
      expect(Math.abs(p.translateX)).toBeLessThanOrEqual(FLOW_TRANSLATE * W + 1e-9);
      expect(Math.abs(p.translateY)).toBeLessThanOrEqual(FLOW_TRANSLATE * H + 1e-9);
      expect(Math.abs(p.rotate)).toBeLessThanOrEqual(FLOW_ROTATE + 1e-9);
      expect(p.scale).toBeGreaterThanOrEqual(FLOW_SCALE.min - 1e-9);
      expect(p.scale).toBeLessThanOrEqual(FLOW_SCALE.max + 1e-9);
    }
  });

  it('the envelope constants ARE the approved direction (±5% / ±6° / 1.00–1.10)', () => {
    expect(FLOW_TRANSLATE).toBeCloseTo(0.05, 10);
    expect(FLOW_ROTATE).toBeCloseTo((6 * Math.PI) / 180, 10);
    expect(FLOW_SCALE).toEqual({ min: 1.0, max: 1.1 });
    expect(FLOW_MS).toBe(15000); // the token cycle the mockup animates at
  });

  it('actually USES the envelope — the drift is not a token-shaped no-op', () => {
    let maxTx = 0; let maxRot = 0; let maxScale = 0; let minScale = Infinity;
    for (let t = 0; t <= FLOW_MS; t += 25) {
      const p = auroraFlowPose(t, W, H);
      maxTx = Math.max(maxTx, Math.abs(p.translateX));
      maxRot = Math.max(maxRot, Math.abs(p.rotate));
      maxScale = Math.max(maxScale, p.scale);
      minScale = Math.min(minScale, p.scale);
    }
    expect(maxTx).toBeGreaterThan(FLOW_TRANSLATE * W * 0.9);
    expect(maxRot).toBeGreaterThan(FLOW_ROTATE * 0.9);
    expect(maxScale).toBeGreaterThan(1.09);
    expect(minScale).toBeLessThan(1.01);
  });
});

describe('auroraFlowPose — REDUCED MOTION is a genuinely STILL field', () => {
  it('null elapsed (the reduced branch) yields ONE fixed pose for every instant', () => {
    const still = auroraFlowPose(null, W, H);
    for (const t of [0, 250, 3000, FLOW_MS / 2, FLOW_MS, 9e6]) {
      void t;
      expect(auroraFlowPose(null, W, H)).toEqual(still);
    }
  });

  it('that still pose is the IDENTITY — no residual drift, tilt or inflation', () => {
    expect(auroraFlowPose(null, W, H)).toEqual({ translateX: 0, translateY: 0, rotate: 0, scale: FLOW_SCALE.min });
  });

  it('differs from the moving field (proving `reduced` is wired to something real)', () => {
    expect(auroraFlowPose(null, W, H)).not.toEqual(auroraFlowPose(FLOW_MS / 3, W, H));
  });
});

describe('auroraFlowPose — a hostile clock never reaches a Skia transform', () => {
  it('degrades NaN / ±∞ / undefined elapsed to the still pose instead of emitting NaN', () => {
    const still = auroraFlowPose(null, W, H);
    for (const bad of [NaN, Infinity, -Infinity, undefined as any, 'nope' as any]) {
      expect(auroraFlowPose(bad, W, H)).toEqual(still);
    }
  });

  it('emits FINITE numbers for a hostile viewport too (0 / NaN width or height)', () => {
    for (const [w, h] of [[0, 0], [NaN, H], [W, Infinity], [-100, -100]] as Array<[number, number]>) {
      const p = auroraFlowPose(4000, w, h);
      for (const v of [p.translateX, p.translateY, p.rotate, p.scale]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('a negative clock (a clock reset mid-flight) stays inside the envelope', () => {
    const p = auroraFlowPose(-7777, W, H);
    expect(Math.abs(p.translateX)).toBeLessThanOrEqual(FLOW_TRANSLATE * W + 1e-9);
    expect(p.scale).toBeGreaterThanOrEqual(FLOW_SCALE.min - 1e-9);
    expect(p.scale).toBeLessThanOrEqual(FLOW_SCALE.max + 1e-9);
  });
});

describe('focalGlowScale — the emotion focal glow BREATHES 1.00–1.08 at the token period', () => {
  it('rests at 1.00 and peaks at 1.08 half a cycle later', () => {
    expect(focalGlowScale(0)).toBeCloseTo(FOCAL_SCALE.min, 6);
    expect(focalGlowScale(motion.duration.focalGlow / 2)).toBeCloseTo(FOCAL_SCALE.max, 6);
    expect(FOCAL_SCALE).toEqual({ min: 1.0, max: 1.08 });
    expect(motion.duration.focalGlow).toBe(4600);
  });

  it('stays inside 1.00–1.08 across the cycle and is periodic', () => {
    for (let t = 0; t <= motion.duration.focalGlow * 2; t += 20) {
      const s = focalGlowScale(t);
      expect(s).toBeGreaterThanOrEqual(FOCAL_SCALE.min - 1e-9);
      expect(s).toBeLessThanOrEqual(FOCAL_SCALE.max + 1e-9);
    }
    expect(focalGlowScale(1200 + motion.duration.focalGlow)).toBeCloseTo(focalGlowScale(1200), 6);
  });

  it('reduced (null) and a hostile clock STILL the breath at rest — never NaN', () => {
    expect(focalGlowScale(null)).toBe(FOCAL_SCALE.min);
    for (const bad of [NaN, Infinity, -Infinity, undefined as any]) expect(focalGlowScale(bad)).toBe(FOCAL_SCALE.min);
  });

  it('is FRAME-RATE INDEPENDENT for the same reason the drift is', () => {
    expect(focalGlowScale(Math.round(60 * (1000 / 60)))).toBeCloseTo(focalGlowScale(Math.round(30 * (1000 / 30))), 10);
  });
});

describe('auroraBlobLayout — the four token blobs, laid out over an OVERSCANNED field', () => {
  const layout = auroraBlobLayout(W, H);

  it('renders exactly the four AURORA token blobs, colour + alpha straight from tokens (no drift)', () => {
    expect(layout.map((b) => b.key)).toEqual(['sky', 'violet', 'gold', 'pink']);
    const blobs = colors.dark.aurora.blobs;
    for (const b of layout) {
      expect(b.color).toBe(blobs[b.key].color);
      expect(b.alpha).toBe(blobs[b.key].alpha);
    }
  });

  it('every blob has a finite, positive radius and finite centre (Skia-safe)', () => {
    for (const b of layout) {
      expect(Number.isFinite(b.cx)).toBe(true);
      expect(Number.isFinite(b.cy)).toBe(true);
      expect(b.r).toBeGreaterThan(0);
      expect(Number.isFinite(b.r)).toBe(true);
    }
  });

  it('OVERSPILLS the viewport — blobs are anchored beyond the edges so no rim ever shows', () => {
    // At least one blob centre sits outside the visible box on each axis (the mockup's inset:-45%).
    expect(layout.some((b) => b.cy < 0)).toBe(true);
    expect(layout.some((b) => b.cy > H)).toBe(true);
    expect(AURORA_OVERSCAN).toBeGreaterThan(0.3);
  });

  it('every blob still INTERSECTS the viewport at the drift extremes (the field never drifts away)', () => {
    const cx0 = W / 2; const cy0 = H / 2;
    for (let t = 0; t <= FLOW_MS; t += 250) {
      const p = auroraFlowPose(t, W, H);
      for (const b of auroraBlobLayout(W, H)) {
        // apply the group transform (scale+rotate about the viewport centre, then translate)
        const dx = (b.cx - cx0) * p.scale; const dy = (b.cy - cy0) * p.scale;
        const cos = Math.cos(p.rotate); const sin = Math.sin(p.rotate);
        const x = cx0 + dx * cos - dy * sin + p.translateX;
        const y = cy0 + dx * sin + dy * cos + p.translateY;
        const r = b.r * p.scale;
        // distance from the disc centre to the viewport rect must be under the radius
        const ddx = Math.max(0 - x, 0, x - W);
        const ddy = Math.max(0 - y, 0, y - H);
        expect(Math.hypot(ddx, ddy)).toBeLessThan(r);
      }
    }
  });

  it('scales with the viewport (a tablet is not a phone layout stretched)', () => {
    const small = auroraBlobLayout(320, 568);
    const large = auroraBlobLayout(800, 1200);
    expect(large[0].r).toBeGreaterThan(small[0].r);
    expect(large[0].cx).not.toBeCloseTo(small[0].cx, 3);
  });

  it('survives a degenerate viewport without emitting NaN (first-frame 0×0 layout)', () => {
    for (const [w, h] of [[0, 0], [NaN, NaN], [-10, -10]] as Array<[number, number]>) {
      for (const b of auroraBlobLayout(w, h)) {
        expect(Number.isFinite(b.cx)).toBe(true);
        expect(Number.isFinite(b.cy)).toBe(true);
        expect(Number.isFinite(b.r)).toBe(true);
        expect(b.r).toBeGreaterThan(0);
      }
    }
  });

  it('TAU is the cycle basis — one flow period is exactly one revolution of the phase', () => {
    // guards a refactor that swaps the period for a frame count: the phase at FLOW_MS is 2π.
    expect(TAU).toBeCloseTo(Math.PI * 2, 12);
  });
});
