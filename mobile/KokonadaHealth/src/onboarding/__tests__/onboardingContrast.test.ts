import { colors, emotionAnchors, type ColorScheme, type ThemeName } from '../../design/tokens';
import { contrastRatio, parseHex, flatten, AA_NORMAL } from '../../design/contrast';

// The FTUE copy sits BELOW the hero, over surface.base — never on the aura's bright core
// (which, in dark, would be illegible: near-white foam over bright cyan is ~2.5:1). This
// test is the gate for that contract: the copy line (content.primary) must clear WCAG 2.2
// AA-normal (4.5) over its real backdrop AND over a faint aura BLEED, in BOTH themes —
// including light "Clinical Premium", where the teal lifts the porcelain more than dark's
// cyan lifts the abyss. A token edit that darkens the ink or brightens the aura fails HERE.

const themes: ThemeName[] = ['dark', 'light'];

// The aura's dim breath (BreathingGlow's rest opacity) is a conservative upper bound for how
// much glow can reach the copy zone below the hero — realistically it is far less (the glow
// is a bounded circle above the copy). If the copy clears AA even under this bleed, it is safe.
const AURA_BLEED_OPACITY = 0.45;

function flatHex(fg: string, alpha: number, bg: string): string {
  const c = flatten(parseHex(fg), alpha, parseHex(bg));
  return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

describe.each(themes)('onboarding copy legibility — theme "%s"', (name) => {
  const c: ColorScheme = colors[name];

  it('copy (content.primary) clears AA-normal over its real backdrop, surface.base', () => {
    expect(contrastRatio(c.content.primary, c.surface.base)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  // Every hue the panels can show behind/near the copy: the brand glow (panels 1 & 3) and
  // the calm↔warm drift (panel 2). None may drop the copy below AA under a faint bleed.
  const auraHues: Array<[string, string]> = [
    ['accent.glow', c.accent.glow],
    ['emotionAnchors.calm', emotionAnchors.calm],
    ['emotionAnchors.warm', emotionAnchors.warm],
  ];
  it.each(auraHues)('copy clears AA-normal over a faint %s aura bleed', (_label, hue) => {
    const bled = flatHex(hue, AURA_BLEED_OPACITY, c.surface.base);
    expect(contrastRatio(c.content.primary, bled)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});
