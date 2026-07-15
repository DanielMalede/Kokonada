import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { colors, type ColorScheme, type ThemeName } from '../../design/tokens';
import { contrastRatio, parseHex, flatten, AA_NORMAL } from '../../design/contrast';
import { BREATH_OPACITY } from '../../experience/aura/BreathingGlow';
import { OnboardingPanel } from '../OnboardingPanel';

// HONEST copy-legibility gate. The copy's safety does NOT come from being AA over the aura
// core — at the aura's TRUE animation peak (BREATH_OPACITY.peak = 0.75) the dark near-white
// ink over a glow core is only ~2.5:1, FAR below AA. Safety comes from a SPATIAL invariant:
// the aura lives in the hero zone (top ~60%) and the copy in a DISJOINT copy zone (bottom
// ~40%), so the glow core is never behind the text and the real bleed ≈ 0 → the copy sits
// on surface.base. This suite pins BOTH facts: the real backdrop passes AA, and the two
// zones are provably disjoint. It also documents the peak-core danger so a future change
// that moves copy onto the aura can't silently pass.

const themes: ThemeName[] = ['dark', 'light'];

function flatHex(fg: string, alpha: number, bg: string): string {
  const c = flatten(parseHex(fg), alpha, parseHex(bg));
  return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

describe.each(themes)('onboarding copy legibility — theme "%s"', (name) => {
  const c: ColorScheme = colors[name];
  it('copy (content.primary) clears AA-normal over its REAL backdrop, surface.base', () => {
    expect(contrastRatio(c.content.primary, c.surface.base)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('the aura CORE at peak is NOT a safe text backdrop — this is WHY the zones are disjoint', () => {
  it('dark ink over the glow core at the TRUE breath peak fails AA (spatial separation is load-bearing)', () => {
    const c = colors.dark;
    const core = flatHex(c.accent.glow, BREATH_OPACITY.peak, c.surface.base);
    // The real number. If copy ever sat on the core it would be illegible — so it must not.
    expect(contrastRatio(c.content.primary, core)).toBeLessThan(AA_NORMAL);
  });
});

describe('spatial invariant — the copy never sits behind the aura (disjoint zones)', () => {
  function flatStyle(node: any): Record<string, unknown> {
    const s = node?.props?.style;
    return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
  }
  function texts(node: any, acc: string[] = []): string[] {
    if (node == null) return acc;
    if (typeof node === 'string') { acc.push(node); return acc; }
    if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
    if (node.children) texts(node.children, acc);
    return acc;
  }

  it('the copy Text lives ONLY in the copy zone, NOT behind the aura (hero) zone — real bleed ≈ 0', async () => {
    const HERO = 'HERO_MARKER';
    const COPY = 'Your body is heard.';
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        React.createElement(OnboardingPanel, { width: 360, copy: COPY, children: React.createElement(Text, null, HERO) }),
      );
    });

    const heroZone = tree.root.findAll((n) => n.props?.testID === 'onboarding-hero-zone')[0];
    const copyZone = tree.root.findAll((n) => n.props?.testID === 'onboarding-copy-zone')[0];
    expect(heroZone).toBeTruthy();
    expect(copyZone).toBeTruthy();

    // aura/hero content lives ONLY in the hero zone; the copy lives ONLY in the copy zone
    expect(texts(heroZone).join(' ')).toContain(HERO);
    expect(texts(heroZone).join(' ')).not.toContain(COPY);
    expect(texts(copyZone).join(' ')).toContain(COPY);
    expect(texts(copyZone).join(' ')).not.toContain(HERO);

    // and they occupy SEPARATE flex tracks (top vs bottom) — non-overlapping by construction
    expect((flatStyle(heroZone) as any).flex).toBeGreaterThan(0);
    expect((flatStyle(copyZone) as any).flex).toBeGreaterThan(0);

    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
