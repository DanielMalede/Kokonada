import {
  iconSvg,
  foregroundSvg,
  backgroundSvg,
  monochromeSvg,
  tintedSvg,
  bootsplashSvg,
} from '../buildBrandSvg.mjs';
import { treatments } from '../../../src/design/brandMark.geometry';
import { BREATH_OPACITY } from '../../../src/experience/aura/breath';

// The SVG builders paint the launcher/bootsplash assets from the SAME shared geometry as the
// live Skia mark. These pin the spec invariants in the emitted markup: the full-bleed opaque
// icon, the SoftGlow bloom (fades to alpha 0), the two rings, the seed; the monochrome having
// NO glow; and the bootsplash bloom baked at the breath's rest opacity (the zero-jump seam).

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe('buildBrandSvg — Aurora Seed asset SVGs', () => {
  it('paints the dark (abyss) full-bleed icon: opaque bg + bloom gradient + two rings + seed', () => {
    const s = iconSvg('dark');
    expect(s).toContain(`fill="${treatments.dark.bg}"`); // opaque full-bleed background
    expect(s).toContain('radialGradient');
    expect(s).toContain('stop-opacity="0.55"'); // bloom peak
    expect(s).toContain('stop-opacity="0.28"'); // bloom mid
    expect(s).toContain('stop-opacity="0"'); // fades to 0 — no hard rim
    expect(s).toContain(`fill="${treatments.dark.coreBody}"`);
    expect(s).toContain(`fill="${treatments.dark.coreHighlight}"`);
    expect(count(s, `stroke="${treatments.dark.ring}"`)).toBe(2); // two rings
  });

  it('recolours for the light (porcelain) treatment', () => {
    const s = iconSvg('light');
    expect(s).toContain(`fill="${treatments.light.bg}"`);
    expect(s).toContain(`fill="${treatments.light.coreBody}"`);
    expect(count(s, `stroke="${treatments.light.ring}"`)).toBe(2);
  });

  it('foreground is the mark on TRANSPARENT (no full-bleed bg rect) so the launcher can parallax it', () => {
    const s = foregroundSvg();
    expect(s).not.toContain('<rect');
    expect(s).toContain('radialGradient');
    expect(count(s, `stroke="${treatments.dark.ring}"`)).toBe(2);
  });

  it('background is the flat abyss field only (no mark)', () => {
    const s = backgroundSvg();
    expect(s).toContain(`<rect`);
    expect(s).toContain(`fill="${treatments.dark.bg}"`);
    expect(s).not.toContain('radialGradient');
    expect(count(s, 'stroke=')).toBe(0);
  });

  it('monochrome is one flat white silhouette — NO gradient, NO blur, NO accent (mono cannot glow)', () => {
    const s = monochromeSvg();
    expect(s).toContain('#FFFFFF');
    expect(s).not.toContain('radialGradient');
    expect(s).not.toContain('feGaussianBlur');
    expect(s).not.toContain(treatments.dark.ring); // no #31E1C4
    expect(count(s, 'stroke="#FFFFFF"')).toBe(2); // two rings
    expect(s).toContain('fill="#FFFFFF"'); // the seed core
  });

  it('the iOS tinted asset is exactly the monochrome silhouette', () => {
    expect(tintedSvg()).toBe(monochromeSvg());
  });

  it('bakes the bootsplash bloom at the breath REST opacity — the OS-splash → RN-splash seam', () => {
    const s = bootsplashSvg();
    expect(BREATH_OPACITY.rest).toBe(0.45);
    expect(s).toContain(`stop-opacity="${BREATH_OPACITY.rest}"`); // bloom peak == rest
    expect(s).toContain('stop-opacity="0"'); // still fades to 0
    expect(count(s, `stroke="${treatments.dark.ring}"`)).toBe(2); // rings + seed present
  });
});
