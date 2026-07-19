import { CENTER, SAFE_RADIUS, geometry, treatments, monochrome } from '../brandMark.geometry';
import { colors } from '../tokens';

// The Aurora Seed geometry is PURE DATA — the single source that feeds BOTH the Skia
// BrandMark component and the SVG asset script (no duplicated numbers). These tests pin
// the spec invariants (safe-circle clip, SoftGlow "fade to 0" law, hex parity with the
// brand tokens, monochrome-has-no-glow) so a stray edit to the mark cannot drift silently.

describe('brandMark.geometry — Aurora Seed constants', () => {
  it('is centred on the unit canvas', () => {
    expect(CENTER).toBe(0.5);
  });

  it('keeps the essential mark inside the Android-12 circle-mask safe radius', () => {
    // Ring 2 is the outermost stroked circle; its outer edge must clear the mask.
    const ring2Outer = geometry.ring2.r + geometry.ring2.sw / 2;
    expect(ring2Outer).toBeCloseTo(0.2905, 4);
    expect(ring2Outer).toBeLessThanOrEqual(SAFE_RADIUS);
  });

  it('orders the concentric radii core < ring1 < ring2 < bloom', () => {
    expect(geometry.core.highlight.r).toBeLessThan(geometry.core.body.r);
    expect(geometry.core.body.r).toBeLessThan(geometry.ring1.r);
    expect(geometry.ring1.r).toBeLessThan(geometry.ring2.r);
    expect(geometry.ring2.r).toBeLessThan(geometry.bloom.r);
  });

  it('the faint outer ring is thinner than the breath ring', () => {
    expect(geometry.ring2.sw).toBeLessThan(geometry.ring1.sw);
  });

  it('the core-body blur clears the SoftGlow softness floor (>= 0.25 x core radius)', () => {
    expect(geometry.core.body.blur).toBeGreaterThanOrEqual(0.25 * geometry.core.body.r);
  });

  it('every treatment bloom obeys the SoftGlow law — its last stop fades to alpha 0 (no hard rim)', () => {
    for (const t of [treatments.dark, treatments.light]) {
      const last = t.bloomStops[t.bloomStops.length - 1];
      expect(last.offset).toBe(1);
      expect(last.alpha).toBe(0);
    }
  });

  it('carries the exact dark (abyss) spec literals', () => {
    expect(treatments.dark.bg).toBe('#060B11');
    expect(treatments.dark.coreHighlight).toBe('#FFF7E9');
    expect(treatments.dark.coreBody).toBe('#F7D08A');
    expect(treatments.dark.ring).toBe('#F2C879');
    expect(treatments.dark.ring1Alpha).toBe(0.85);
    expect(treatments.dark.ring2Alpha).toBe(0.38);
    expect(treatments.dark.bloom).toBe('#F2C879');
    expect(treatments.dark.bloomStops.map((s) => s.alpha)).toEqual([0.55, 0.28, 0]);
  });

  it('carries the exact light (porcelain) spec literals', () => {
    expect(treatments.light.bg).toBe('#F3F8FA');
    expect(treatments.light.coreHighlight).toBe('#E0A93A');
    expect(treatments.light.coreBody).toBe('#9A6E12');
    expect(treatments.light.ring).toBe('#7A5A10');
    expect(treatments.light.ring1Alpha).toBe(0.9);
    expect(treatments.light.ring2Alpha).toBe(0.3);
  });

  it('rides the brand tokens — no drift from surface.base / accent.glow', () => {
    expect(treatments.dark.bg).toBe(colors.dark.surface.base);
    expect(treatments.dark.ring).toBe(colors.dark.accent.glow);
    expect(treatments.light.bg).toBe(colors.light.surface.base);
    expect(treatments.light.ring).toBe(colors.light.accent.glow);
  });

  it('swaps the palette between treatments (dark != light core)', () => {
    expect(treatments.dark.coreBody).not.toBe(treatments.light.coreBody);
    expect(treatments.dark.ring).not.toBe(treatments.light.ring);
  });

  it('monochrome is a single flat white silhouette with NO bloom or gradient (mono cannot glow)', () => {
    expect(monochrome.color).toBe('#FFFFFF');
    expect((monochrome as Record<string, unknown>).bloom).toBeUndefined();
    expect((monochrome as Record<string, unknown>).bloomStops).toBeUndefined();
    // silhouette radii reuse the shared geometry (no duplicated numbers)
    expect(monochrome.core.r).toBe(geometry.core.body.r);
    expect(monochrome.ring1.r).toBe(geometry.ring1.r);
    expect(monochrome.ring2.r).toBe(geometry.ring2.r);
  });
});
