import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { LivingAurora } from '../LivingAurora';
import { auroraBlobLayout, FLOW_SCALE } from '../auroraField';
import { colors, type ThemeName } from '../../../design/tokens';

// The LIVING AURORA component wires the pure auroraField math (unit-attacked in auroraField.test.ts)
// to Skia on the UI thread. Skia paint is verified on-device; here — under the Skia/reanimated stubs
// (useClock → {value:0}, useDerivedValue → {value: fn()}) — we pin the WIRING: the four token blobs
// are laid out, the canvas rides surface.canvas*, and the ambient drift is frozen to the STILL pose
// when reduce-motion is set (the field is genuinely static, not merely slower).

function renderWith(scheme: ThemeName, reduced = false, w = 390, h = 844) {
  jest.spyOn(RN, 'useColorScheme').mockReturnValue(scheme);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(<LivingAurora width={w} height={h} reduced={reduced} />); });
  return tree;
}
afterEach(() => jest.restoreAllMocks());

// every node carrying a `colors` array is a gradient stub; the blob gradients fade a hue → transparent.
const gradients = (t: ReactTestRenderer.ReactTestRenderer) => t.root.findAll((n) => Array.isArray(n.props?.colors));
const blobGradients = (t: ReactTestRenderer.ReactTestRenderer) => gradients(t).filter((n) => /rgba\([^)]*,0\)$/.test(String(n.props.colors[1])));
// the drifting field is the one Group carrying the animated transform + centre origin.
const fieldGroup = (t: ReactTestRenderer.ReactTestRenderer) => t.root.findAll((n) => n.props?.transform && n.props?.origin)[0];
const pose = (t: ReactTestRenderer.ReactTestRenderer) => {
  const arr = fieldGroup(t).props.transform.value as Array<Record<string, number>>;
  const get = (k: string) => { const e = arr.find((o) => k in o); return e ? e[k] : undefined; };
  return { translateX: get('translateX'), translateY: get('translateY'), rotate: get('rotate'), scale: get('scale') };
};

describe('LivingAurora — the four token blobs are laid out over the canvas (both faces)', () => {
  it('paints exactly the four aurora blob hues as soft radial glows, in dark AND light', () => {
    for (const name of ['dark', 'light'] as ThemeName[]) {
      const tree = renderWith(name);
      const hues = blobGradients(tree).map((n) => n.props.colors[0]);
      const expected = auroraBlobLayout(390, 844).map((b) => b.color);
      expect(hues.sort()).toEqual([...expected].sort());
      ReactTestRenderer.act(() => { tree.unmount(); });
    }
  });

  it('the canvas base gradient rides surface.canvasTop → surface.canvasBottom per face', () => {
    const dark = renderWith('dark');
    expect(gradients(dark).some((n) => n.props.colors[0] === colors.dark.surface.canvasTop && n.props.colors[1] === colors.dark.surface.canvasBottom)).toBe(true);
    ReactTestRenderer.act(() => { dark.unmount(); });
    const light = renderWith('light');
    expect(gradients(light).some((n) => n.props.colors[0] === colors.light.surface.canvasTop && n.props.colors[1] === colors.light.surface.canvasBottom)).toBe(true);
    ReactTestRenderer.act(() => { light.unmount(); });
  });
});

describe('LivingAurora — reduce-motion freezes the field to the STILL identity pose (the new pin)', () => {
  it('reduced → the drift group sits at the identity pose (no translate, no tilt, scale 1.00)', () => {
    const tree = renderWith('dark', true);
    const p = pose(tree);
    expect(p.translateX).toBe(0);
    expect(p.translateY).toBe(0);
    expect(p.rotate).toBe(0);
    expect(p.scale).toBe(FLOW_SCALE.min);
    ReactTestRenderer.act(() => { tree.unmount(); });
  });

  it('NOT reduced → the field is ALIVE (a non-zero tilt/drift proves reduced is wired to something real)', () => {
    const tree = renderWith('dark', false);
    const p = pose(tree);
    // at the stub clock (t=0) the still pose has rotate 0 + translateY 0; the moving field does not.
    expect(p.rotate).not.toBe(0);
    expect(p.translateY).not.toBe(0);
    ReactTestRenderer.act(() => { tree.unmount(); });
  });
});

describe('LivingAurora — Skia-safe against a hostile first-frame viewport', () => {
  it('mounts + unmounts a 0×0 layout without throwing a NaN into the canvas', () => {
    const tree = renderWith('dark', false, 0, 0);
    expect(tree).toBeTruthy();
    for (const b of blobGradients(tree)) expect(b.props.colors[0]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    ReactTestRenderer.act(() => { tree.unmount(); });
  });
});
