// WCAG 2.2 contrast math. The token system's contract (spec §2 / §7) is that EVERY
// content-over-surface pairing passes AA, and it is verified in a test — so the ratio
// computation lives here as pure, dependency-free functions rather than a design-time
// eyeball. sRGB → relative luminance → contrast ratio, exactly per the WCAG definition.

export type Hex = `#${string}`;

/** Parse #rgb / #rrggbb into 0–255 channels. Throws on malformed input (a bad token
 *  must fail loudly in the test, never silently pass as black). */
export function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Bad hex color: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

// Composite a possibly-translucent color over an opaque backdrop (glass/overlay tokens
// carry alpha; contrast must be judged against what the eye actually sees).
export function flatten(fg: { r: number; g: number; b: number }, alpha: number, bg: { r: number; g: number; b: number }) {
  const a = Math.max(0, Math.min(1, alpha));
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
  };
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio in [1, 21]. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const AA_NORMAL = 4.5; // body text
export const AA_LARGE = 3.0;  // ≥18.66px bold or ≥24px, and UI components/graphics

export function passesAA(a: string, b: string, large = false): boolean {
  return contrastRatio(a, b) >= (large ? AA_LARGE : AA_NORMAL);
}
