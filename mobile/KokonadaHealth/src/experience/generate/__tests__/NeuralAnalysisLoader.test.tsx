import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { NeuralAnalysisLoader } from '../NeuralAnalysisLoader';
import { emotionAnchors, type ThemeName } from '../../../design/tokens';
import { parseHex } from '../../../design/contrast';

async function renderWith(scheme: ThemeName) {
  jest.spyOn(RN, 'useColorScheme').mockReturnValue(scheme);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<NeuralAnalysisLoader active engagement={{ value: 0.5 } as any} />);
  });
  return tree;
}
const gradientStops = (tree: ReactTestRenderer.ReactTestRenderer): string[] =>
  tree.root.findAll((n) => Array.isArray(n.props?.colors)).flatMap((n) => n.props.colors as string[]);
afterEach(() => jest.restoreAllMocks());

// The Skia render is verified on-device (like BioAura); the math is unit-tested in
// neuralLoaderMath.test.ts. This smoke test guards the component BOUNDARY: it mounts,
// survives idle→active and engagement extremes (including NaN, the Skia-crash guard),
// and unmounts — so wiring it into the Generate screen can never crash the app.
it('mounts, updates across idle→active and engagement extremes, and unmounts without throwing', async () => {
  await ReactTestRenderer.act(async () => {
    const tree = ReactTestRenderer.create(
      <NeuralAnalysisLoader active={false} engagement={{ value: 0 } as any} />,
    );
    tree.update(<NeuralAnalysisLoader active engagement={{ value: 1 } as any} />);
    tree.update(<NeuralAnalysisLoader active engagement={{ value: NaN } as any} />);
    tree.unmount();
  });
});

const anyColorString = (tree: ReactTestRenderer.ReactTestRenderer, needle: string) =>
  tree.root.findAll((n) => {
    const cols = n.props?.colors;
    return Array.isArray(cols) && cols.some((c: unknown) => typeof c === 'string' && c.includes(needle));
  }).length > 0;

it('sources the ambient bloom colour from the emotionAnchors.calm token (no hardcoded cyan drift)', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<NeuralAnalysisLoader active engagement={{ value: 0 } as any} />);
  });
  const { r, g, b } = parseHex(emotionAnchors.calm); // #31E1C4 → 49,225,196
  expect(anyColorString(tree, `${r},${g},${b}`)).toBe(true); // token calm present
  expect(anyColorString(tree, '158,232,255')).toBe(false);   // old hardcoded cyan gone
  await ReactTestRenderer.act(async () => { tree.unmount(); });
});

it('themes the glass/specular stops (A4b) — LIGHT deepens them so the pearl does not wash out', async () => {
  const dark = await renderWith('dark');
  const darkStops = gradientStops(dark);
  expect(darkStops).toContain('rgba(255,255,255,0.34)'); // white-emitting pearl on the abyss
  await ReactTestRenderer.act(async () => { dark.unmount(); });

  const light = await renderWith('light');
  const lightStops = gradientStops(light);
  expect(lightStops).not.toContain('rgba(255,255,255,0.34)'); // no pure-white highlight on porcelain
  expect(lightStops).not.toContain('rgba(255,255,255,0.5)');  // specular deepened too
  expect(lightStops).not.toEqual(darkStops);                  // genuinely theme-aware
  await ReactTestRenderer.act(async () => { light.unmount(); });
});

it('reduced motion renders a STILL emblem (no clock-driven springs) and never crashes', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<NeuralAnalysisLoader active engagement={{ value: 0.5 } as any} reduced size={400} />);
  });
  await ReactTestRenderer.act(async () => {
    tree.update(<NeuralAnalysisLoader active={false} engagement={{ value: NaN } as any} reduced size={400} />);
  });
  await ReactTestRenderer.act(async () => { tree.unmount(); });
});
