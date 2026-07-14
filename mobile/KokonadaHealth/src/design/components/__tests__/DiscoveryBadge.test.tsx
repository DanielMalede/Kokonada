import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { StyleSheet } from 'react-native';
import { DiscoveryBadge } from '../DiscoveryBadge';
import { colors, radius, type as typography, type ThemeName } from '../../tokens';
import type { EmotionQuadrant } from '../../tokens';

// Drive the theme deterministically (the jest preset would otherwise fix one scheme), so light
// AND dark are both exercised — a DoD requirement — and every hue is asserted against the token.
function renderWith(scheme: ThemeName, el: React.ReactElement) {
  jest.spyOn(RN, 'useColorScheme').mockReturnValue(scheme);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(el); });
  return tree;
}
const byId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id)[0];
const flat = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  StyleSheet.flatten(byId(tree, id).props.style) as any;

const QUADRANTS: EmotionQuadrant[] = ['calm', 'joyful', 'intense', 'reflective'];
const THEMES: ThemeName[] = ['dark', 'light'];

afterEach(() => jest.restoreAllMocks());

describe('DiscoveryBadge — content (presence + glyph carry the meaning, never hue)', () => {
  it('renders the ✦ shape glyph and the "New" label', () => {
    const tree = renderWith('dark', <DiscoveryBadge quadrant="calm" />);
    expect(byId(tree, 'discovery-badge-glyph').props.children).toBe('✦');
    expect(byId(tree, 'discovery-badge-label').props.children).toBe('New');
  });

  it('is a pill (radius.pill) with a hairline border', () => {
    const container = flat(renderWith('dark', <DiscoveryBadge quadrant="calm" />), 'discovery-badge');
    expect(container.borderRadius).toBe(radius.pill);
    expect(container.borderWidth).toBe(StyleSheet.hairlineWidth);
  });

  it('the label is a semibold caption', () => {
    const label = flat(renderWith('dark', <DiscoveryBadge quadrant="calm" />), 'discovery-badge-label');
    expect(label.fontSize).toBe(typography.size.caption);
    expect(label.fontWeight).toBe(typography.weight.semibold);
  });
});

describe('DiscoveryBadge — accent variant reads the emotionAccent token per session quadrant (light + dark)', () => {
  for (const theme of THEMES) {
    const c = colors[theme];
    it.each(QUADRANTS)(`${theme} · %s: glyph + border use emotionAccent[q].ink, fill uses .wash, label content.primary`, (q) => {
      const tree = renderWith(theme, <DiscoveryBadge quadrant={q} />);
      const container = flat(tree, 'discovery-badge');
      const glyph = flat(tree, 'discovery-badge-glyph');
      const label = flat(tree, 'discovery-badge-label');
      expect(glyph.color).toBe(c.emotionAccent[q].ink);
      expect(container.borderColor).toBe(c.emotionAccent[q].ink);
      expect(container.backgroundColor).toBe(c.emotionAccent[q].wash);
      expect(label.color).toBe(c.content.primary);
    });
  }

  it('C4: never renders Spotify green (#1DB954 / #1ED760) in any quadrant or theme', () => {
    for (const theme of THEMES) {
      for (const q of QUADRANTS) {
        const tree = renderWith(theme, <DiscoveryBadge quadrant={q} />);
        const container = flat(tree, 'discovery-badge');
        const glyph = flat(tree, 'discovery-badge-glyph');
        for (const val of [container.backgroundColor, container.borderColor, glyph.color]) {
          expect(String(val).toLowerCase()).not.toMatch(/1db954|1ed760/);
        }
      }
    }
  });
});

describe('DiscoveryBadge — neutral variant (future History detail)', () => {
  it('uses content.secondary text + surface.hairline border, no accent wash', () => {
    const c = colors.dark;
    const tree = renderWith('dark', <DiscoveryBadge quadrant="intense" variant="neutral" />);
    const container = flat(tree, 'discovery-badge');
    const glyph = flat(tree, 'discovery-badge-glyph');
    const label = flat(tree, 'discovery-badge-label');
    expect(container.borderColor).toBe(c.surface.hairline);
    expect(container.backgroundColor).toBe('transparent');
    expect(glyph.color).toBe(c.content.secondary);
    expect(label.color).toBe(c.content.secondary);
  });
});

describe('DiscoveryBadge — accessibility', () => {
  it('in-row (default) is decorative and folds into the row label', () => {
    const container = byId(renderWith('dark', <DiscoveryBadge quadrant="calm" />), 'discovery-badge');
    expect(container.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(container.props.accessibilityLabel).toBeUndefined();
  });

  it('standalone exposes accessibilityLabel="New discovery"', () => {
    const container = byId(renderWith('dark', <DiscoveryBadge quadrant="calm" standalone />), 'discovery-badge');
    expect(container.props.accessibilityLabel).toBe('New discovery');
    expect(container.props.importantForAccessibility).not.toBe('no-hide-descendants');
  });
});
