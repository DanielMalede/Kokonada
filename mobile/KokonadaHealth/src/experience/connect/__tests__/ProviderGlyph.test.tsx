import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { Image, StyleSheet } from 'react-native';
import { ProviderGlyph } from '../ProviderGlyph';
import { colors, type ThemeName } from '../../../design/tokens';

// The neutral provider mark: our own initial in a neutral circle, shared by the §4 Connect row and
// the §10 Profile row. HX-3 (designer §1.4 SHOULD): the letter does not grow with the OS font — at
// 2.0 it would fill the fixed 32 dp circle — and, being decorative and a11y-hidden, it loses
// nothing by keeping its proportion. Compliance cleared the "Y" mark (HX-3 verdicts §3, item 4)
// only while it uses neutral theme tokens (never red), is never an <Image>, and is treated exactly
// like the other rows' marks; those conditions are pinned here.

const colorSchemeMock = RN.useColorScheme as unknown as jest.Mock;
const PRESET_COLOR_SCHEME = colorSchemeMock.getMockImplementation();
const forceFace = (scheme: ThemeName) => colorSchemeMock.mockImplementation(() => scheme);
const releaseFace = () => colorSchemeMock.mockImplementation(PRESET_COLOR_SCHEME);

const flat = (node: any): Record<string, any> => (StyleSheet.flatten(node?.props?.style) as any) ?? {};
const trees: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  for (const t of trees.splice(0)) ReactTestRenderer.act(() => { t.unmount(); });
  releaseFace();
});
function render(label: string) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(<ProviderGlyph label={label} />); });
  trees.push(tree);
  const circle = tree.toJSON() as ReactTestRenderer.ReactTestRendererJSON;
  const letter = tree.root.findAll((n) => (n.type as unknown) === 'Text')[0];
  return { tree, circle, letter };
}

describe('ProviderGlyph — the neutral initial mark', () => {
  it('the letter keeps its size at any OS font scale (allowFontScaling is off)', () => {
    const { letter } = render('YouTube');
    expect(letter.props.children).toBe('Y');
    expect(letter.props.allowFontScaling).toBe(false);
  });

  it.each(['light', 'dark'] as ThemeName[])('the YouTube mark is styled exactly like every other row\'s mark, in neutral tokens only (%s)', (face) => {
    forceFace(face);
    const styleOf = (label: string) => { const { circle, letter } = render(label); return { circle: flat(circle), letter: flat(letter) }; };
    const youtube = styleOf('YouTube');
    for (const other of ['Spotify', 'Wearable', 'Health data']) expect(styleOf(other)).toEqual(youtube);
    expect(youtube.circle.backgroundColor).toBe(colors[face].surface.overlay);
    expect(youtube.letter.color).toBe(colors[face].content.secondary);
  });

  it('is never an <Image>: the only content is the initial', () => {
    const { tree } = render('YouTube');
    expect(tree.root.findAllByType(Image)).toHaveLength(0);
    expect(tree.root.findAll((n) => (n.type as unknown) === 'Image')).toHaveLength(0);
    expect(tree.root.findAll((n) => (n.type as unknown) === 'Text').map((n) => n.props.children)).toEqual(['Y']);
  });

  it('is decorative: hidden from accessibility services, so the row\'s composed label carries the meaning', () => {
    const { circle } = render('YouTube');
    expect(circle.props.accessibilityElementsHidden).toBe(true);
    expect(circle.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
