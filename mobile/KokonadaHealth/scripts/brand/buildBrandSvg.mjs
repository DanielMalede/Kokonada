// buildBrandSvg — emits the Aurora Seed as SVG strings, one per asset variant, from the
// SHARED geometry (src/design/brandMark.geometry.ts) and the SHARED breath rest opacity
// (src/experience/aura/breath.ts). Node's type-stripping imports those .ts modules directly,
// so the launcher icons + bootsplash are painted from the SAME numbers as the live Skia mark.
// Pure string builders (no I/O) so they are unit-testable; renderIcons.mjs rasterises them.

import { CENTER, geometry, treatments, monochrome } from '../../src/design/brandMark.geometry.ts';
import { BREATH_OPACITY } from '../../src/experience/aura/breath.ts';

const px = (frac, size) => +(frac * size).toFixed(3);
const c = (size) => px(CENTER, size);

function svg(size, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;
}

// A soft "glow" filter: a blurred copy composited UNDER the sharp source, so a thin ring/seed
// keeps its edge AND gains a bioluminescent halo (the SoftGlow law, in SVG). blur > 0 required.
function glowFilter(id, blurPx) {
  return `<filter id="${id}" x="-75%" y="-75%" width="250%" height="250%">`
    + `<feGaussianBlur stdDeviation="${blurPx}" result="b"/>`
    + `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

// bloom = a radial gradient that fades to alpha 0 before its radius (no hard rim).
function bloomGradient(id, color, stops, size) {
  const cc = c(size);
  const els = stops
    .map((s) => `<stop offset="${s.offset}" stop-color="${color}" stop-opacity="${s.alpha}"/>`)
    .join('');
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cc}" cy="${cc}" r="${px(geometry.bloom.r, size)}">${els}</radialGradient>`;
}

function ringEl(size, r, sw, color, alpha, filterId) {
  return `<circle cx="${c(size)}" cy="${c(size)}" r="${px(r, size)}" fill="none" stroke="${color}" stroke-opacity="${alpha}" stroke-width="${px(sw, size)}" filter="url(#${filterId})"/>`;
}

function seedEls(size, t) {
  const body = `<circle cx="${c(size)}" cy="${c(size)}" r="${px(geometry.core.body.r, size)}" fill="${t.coreBody}" filter="url(#seed)"/>`;
  const hi = `<circle cx="${c(size)}" cy="${c(size)}" r="${px(geometry.core.highlight.r, size)}" fill="${t.coreHighlight}"/>`;
  return body + hi;
}

// bloom + faint ring + breath ring + glowing seed + highlight — the full mark, on transparent.
function markFragment(size, t, bloomColor, bloomStops) {
  const defs = `<defs>`
    + bloomGradient('bloom', bloomColor, bloomStops, size)
    + glowFilter('r2', px(geometry.ring2.blur, size))
    + glowFilter('r1', px(geometry.ring1.blur, size))
    + glowFilter('seed', px(geometry.core.body.blur, size))
    + `</defs>`;
  const bloom = `<circle cx="${c(size)}" cy="${c(size)}" r="${px(geometry.bloom.r, size)}" fill="url(#bloom)"/>`;
  return defs
    + bloom
    + ringEl(size, geometry.ring2.r, geometry.ring2.sw, t.ring, t.ring2Alpha, 'r2')
    + ringEl(size, geometry.ring1.r, geometry.ring1.sw, t.ring, t.ring1Alpha, 'r1')
    + seedEls(size, t);
}

// Full-bleed opaque icon (iOS Any/Dark, Android legacy) — abyss/porcelain background + mark.
export function iconSvg(treatmentName, size = 1024) {
  const t = treatments[treatmentName];
  return svg(size, `<rect width="${size}" height="${size}" fill="${t.bg}"/>` + markFragment(size, t, t.bloom, t.bloomStops));
}

// Android adaptive FOREGROUND — the mark on TRANSPARENT (the background layer is the abyss),
// so the launcher can parallax the aura against the ground on tilt.
export function foregroundSvg(size = 1024) {
  const t = treatments.dark;
  return svg(size, markFragment(size, t, t.bloom, t.bloomStops));
}

// Android adaptive BACKGROUND — the flat abyss field.
export function backgroundSvg(size = 1024) {
  return svg(size, `<rect width="${size}" height="${size}" fill="${treatments.dark.bg}"/>`);
}

// Monochrome silhouette (Android-13 themed / iOS-18 tinted) — one flat white, NO bloom / NO
// gradient / NO blur (a monochrome layer cannot glow): seed + both rings only.
export function monochromeSvg(size = 1024) {
  const cc = c(size);
  const r2 = `<circle cx="${cc}" cy="${cc}" r="${px(monochrome.ring2.r, size)}" fill="none" stroke="${monochrome.color}" stroke-width="${px(monochrome.ring2.sw, size)}"/>`;
  const r1 = `<circle cx="${cc}" cy="${cc}" r="${px(monochrome.ring1.r, size)}" fill="none" stroke="${monochrome.color}" stroke-width="${px(monochrome.ring1.sw, size)}"/>`;
  const core = `<circle cx="${cc}" cy="${cc}" r="${px(monochrome.core.r, size)}" fill="${monochrome.color}"/>`;
  return svg(size, r2 + r1 + core);
}

// iOS tinted appearance == the monochrome silhouette (the OS applies the tint).
export function tintedSvg(size = 1024) {
  return monochromeSvg(size);
}

// Bootsplash still-frame: the mark with its bloom baked at the breath's REST opacity, so the
// OS splash shows the aura exactly where the RN Splash's breath begins → a zero-jump handoff.
export function bootsplashSvg(size = 1024, restOpacity = BREATH_OPACITY.rest) {
  const t = treatments.dark;
  const ratio = t.bloomStops[1].alpha / t.bloomStops[0].alpha; // preserve the falloff shape
  const stops = [
    { offset: 0.0, alpha: restOpacity },
    { offset: 0.35, alpha: +(restOpacity * ratio).toFixed(3) },
    { offset: 1.0, alpha: 0 },
  ];
  return svg(size, markFragment(size, t, t.bloom, stops));
}
