import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { BioAura } from '../BioAura';
import { breathMsForArousal, arousalFromHr, hrGlowColor, BREATH_FLOOR_MS, BREATH_CEIL_MS } from '../auraBreath';
import { deriveAuraUniforms } from '../auraUniforms';
import { emotionAnchors } from '../../../design/tokens';

// The bio-aura ELEVATED (Fork 2A): the pure deriveAuraUniforms keeps driving HR hue/intensity/
// breath; an emotion-accent bloom is composited ADDITIVELY on top when taps exist. Two design
// FAIL conditions are guarded here: the REGULATOR ETHIC (breath SLOWS as arousal rises, never
// speeds up) and NEVER-alarming-red (HR hot-end capped at coral). Skia is on-device; here we
// attack the pure breath math + the component's layer composition + NaN safety.

const findCircle = (tree: ReactTestRenderer.ReactTestRenderer, color: string) =>
  tree.root.findAll((n) => n.props?.color === color && typeof n.props?.r === 'number');

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}

describe('auraBreath — REGULATOR ETHIC (breath slows + deepens as arousal rises, NEVER speeds up)', () => {
  it('resting is the FAST FLOOR (motion.duration.breath) and high arousal the SLOW ceiling', () => {
    expect(breathMsForArousal(0)).toBe(BREATH_FLOOR_MS);
    expect(breathMsForArousal(1)).toBe(BREATH_CEIL_MS);
    expect(BREATH_FLOOR_MS).toBe(4200);
    expect(BREATH_CEIL_MS).toBe(6300); // ~1.5× floor
  });

  it('is monotonic NON-DECREASING in arousal — the breath can only slow, never quicken', () => {
    const xs = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const ms = xs.map(breathMsForArousal);
    for (let i = 1; i < ms.length; i++) expect(ms[i]).toBeGreaterThanOrEqual(ms[i - 1]);
  });

  it('clamps out-of-range / NaN arousal into the floor..ceiling band (never a raced NaN)', () => {
    expect(breathMsForArousal(NaN)).toBe(BREATH_FLOOR_MS);
    expect(breathMsForArousal(-5)).toBe(BREATH_FLOOR_MS);
    expect(breathMsForArousal(9)).toBe(BREATH_CEIL_MS);
  });

  it('a racing heart is met with a SLOWER breath than a resting one (downward entrainment)', () => {
    const resting = breathMsForArousal(arousalFromHr(null));
    const racing = breathMsForArousal(arousalFromHr(190));
    expect(racing).toBeGreaterThan(resting); // FAIL condition if it ever inverts
    expect(arousalFromHr(null)).toBe(0); // no signal = arousal 0 exactly (RESTING glow never leaks in as arousal)
    expect(arousalFromHr(190)).toBeGreaterThan(0.9);
  });
});

describe('auraBreath — hrGlowColor is capped at coral (NEVER alarming red)', () => {
  it('cool calm at rest → soft coral at peak, and never the peak red anchor', () => {
    expect(hrGlowColor(null)).toBe('rgb(242,200,121)');    // emotionAnchors.calm #F2C879
    expect(hrGlowColor(200)).toBe('rgb(229,138,184)');     // emotionAnchors.coral #E58AB8 — the CAP
    expect(hrGlowColor(200)).not.toBe('rgb(179,104,214)'); // never emotionAnchors.peak #B368D6
    expect(emotionAnchors.coral).toBe('#E58AB8');
  });
  it('a non-finite HR degrades to the resting calm colour (never NaN into Skia)', () => {
    expect(hrGlowColor(NaN)).toBe('rgb(242,200,121)');
    expect(hrGlowColor(Infinity)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });
});

describe('auraUniforms is NOT modified by the accent layer (sealed derivation pin)', () => {
  it('deriveAuraUniforms still yields its unchanged HR mapping', () => {
    expect(deriveAuraUniforms(null)).toEqual({ hue: 210, intensity: 0.12, pulseHz: 0.9 });
    const u = deriveAuraUniforms(120);
    expect(u.hue).toBeCloseTo(210 - ((120 - 40) / 160) * 210, 6);
    expect(Number.isFinite(u.hue) && Number.isFinite(u.intensity) && u.pulseHz > 0).toBe(true);
  });
});

describe('BioAura — additive accent composition', () => {
  it('WITHOUT an accentColor renders the HR glow ONLY (identical read to today)', async () => {
    const tree = await render(<BioAura hr={72} size={200} />);
    expect(findCircle(tree, hrGlowColor(72)).length).toBeGreaterThan(0); // HR layer present
    expect(findCircle(tree, '#D9ADFF')).toHaveLength(0);                  // no emotion tint layer
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('WITH an accentColor composites a SECOND glow tinted to that emotion ink', async () => {
    const tree = await render(<BioAura hr={72} size={200} accentColor="#D9ADFF" />);
    expect(findCircle(tree, hrGlowColor(72)).length).toBeGreaterThan(0); // HR layer still there
    expect(findCircle(tree, '#D9ADFF').length).toBeGreaterThan(0);        // accent bloom on top
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a NaN HR + a malformed accent mount + unmount without throwing (Skia crash guard)', async () => {
    const tree = await render(<BioAura hr={NaN as any} size={120} accentColor={'not-a-color' as any} reduced />);
    expect(tree).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
