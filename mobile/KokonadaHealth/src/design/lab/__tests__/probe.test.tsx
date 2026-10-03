import React from 'react';
import { PixelRatio, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Probe, ProbeRegistry } from '../probe/Probe';
import { probeRect, toPixels } from '../probe/geometry';

// MB-085. A probe is an element the harness samples on the device. It reports where it is on the
// screen, in window coordinates, both in dp and in physical pixels (px = dp x the device's pixel
// ratio), because the capture is read in pixels and the layout is written in dp.
//
// The jest preset's View is a mock class whose measureInWindow never answers. Each test gives it the
// device's behaviour (answer with where this view was laid out), as GenerateScreen.test.tsx does.

const hostProbe = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props.nativeID === `probe-${id}`)[0];

function deviceAnswers(rects: Record<string, number[]>) {
  const asked: string[] = [];
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow')
    .mockImplementation(function (this: { props: { nativeID?: string } }, cb: unknown) {
      const id = this.props.nativeID ?? '';
      asked.push(id);
      const r = rects[id];
      if (r) (cb as (...v: number[]) => void)(...r);
    });
  return asked;
}
afterEach(() => jest.restoreAllMocks());

describe('probe geometry', () => {
  it('px = dp x ratio, on every edge', () => {
    expect(toPixels({ x: 10, y: 20, width: 30, height: 40 }, 2.625))
      .toEqual({ x: 26.25, y: 52.5, width: 78.75, height: 105 });
  });

  it('a rect that is not finite, or has a negative size, is no measurement', () => {
    expect(probeRect({ x: NaN, y: 0, width: 1, height: 1 }, 2)).toBeNull();
    expect(probeRect({ x: 0, y: 0, width: -1, height: 1 }, 2)).toBeNull();
    expect(probeRect({ x: 0, y: 0, width: 1, height: 1 }, NaN)).toBeNull();
    expect(probeRect({ x: 0, y: 0, width: 0, height: 0 }, 2)).toEqual({ dp: { x: 0, y: 0, width: 0, height: 0 }, px: { x: 0, y: 0, width: 0, height: 0 } });
  });
});

describe('<Probe>', () => {
  it('reports its window rect in dp and in px = dp x PixelRatio.get() when laid out', () => {
    const ratio = PixelRatio.get();
    expect(ratio).not.toBe(1); // otherwise dp and px would be indistinguishable here
    const asked = deviceAnswers({ 'probe-mark': [12, 34.5, 56, 78] });
    const seen: unknown[] = [];
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ProbeRegistry onMeasure={(id, rect) => seen.push([id, rect])}>
          <Probe id="mark"><Text>mark</Text></Probe>
        </ProbeRegistry>,
      );
    });
    expect(seen).toEqual([]); // nothing until the layout pass
    act(() => { hostProbe(tree, 'mark').props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 56, height: 78 } } }); });
    expect(asked).toEqual(['probe-mark']); // it asked the view itself, in window coordinates
    expect(seen).toEqual([['mark', {
      dp: { x: 12, y: 34.5, width: 56, height: 78 },
      px: { x: 12 * ratio, y: 34.5 * ratio, width: 56 * ratio, height: 78 * ratio },
    }]]);
  });

  it('stays a real view (collapsable={false}) so the renderer cannot flatten it away', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => { tree = ReactTestRenderer.create(<ProbeRegistry onMeasure={() => {}}><Probe id="a" /></ProbeRegistry>); });
    expect(hostProbe(tree, 'a').props.collapsable).toBe(false);
  });

  it('does not report a measurement that is not a measurement', () => {
    const asked = deviceAnswers({ 'probe-gone': [NaN, NaN, NaN, NaN] });
    const seen: unknown[] = [];
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(<ProbeRegistry onMeasure={(id, rect) => seen.push([id, rect])}><Probe id="gone" /></ProbeRegistry>);
    });
    act(() => { hostProbe(tree, 'gone').props.onLayout({ nativeEvent: { layout: {} } }); });
    expect(asked).toEqual(['probe-gone']); // it did measure, so the silence below is the refusal, not a skipped call
    expect(seen).toEqual([]);
  });

  it('refuses to render outside a ProbeRegistry: an unreported probe would stall READY silently', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => act(() => { ReactTestRenderer.create(<Probe id="lost" />); })).toThrow(/ProbeRegistry/);
  });
});
