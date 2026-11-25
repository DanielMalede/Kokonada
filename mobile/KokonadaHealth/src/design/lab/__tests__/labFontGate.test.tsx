import React from 'react';
import { EventEmitter } from 'events';
import { StyleSheet, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { LabRoot, LAB_EVENTS } from '../LabRoot';
import { CALIBRATION_TEXT, FALLBACK_PROBE, FONT_CHECK_DEADLINE_MS, MISSING_FACE, type LabFaceId } from '../fonts';
import { Probe } from '../probe/Probe';
import type { Scene } from '../scenes';
import { labMounts } from './__fixtures__/labMounts';

// Each test's LabRoot is unmounted after it, and no timer the lab armed may outlive the test (UI-261).
const mounts = labMounts();
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// UI-072. READY said "the fonts are ready" on a constant (`fontsReady` defaulted to true), so a scene drawn in a face the
// APK does not hold would have sent READY over Android's fallback face. React Native has no font-loading event on
// Android: a family resolves when its text is first laid out, from fonts/<family>.ttf in the APK's assets, and a family
// it cannot find is drawn in the default face, silently. So the gate measures what React Native drew: the scene declares
// its faces, the lab lays out one hidden calibration line in each face and one in a face that cannot exist (the fallback),
// and READY waits until every face has drawn at a width that is not the fallback's. A face that drew at the fallback's
// width is not in the APK: one ERROR naming it, and never READY.
//
// Stateful fakes with the device's semantics: a frame source that draws one frame per tick, an emitter for the activity's
// events, probes that measure where they were laid out, and font probes laid out at the width the test says React Native
// measured (the jest renderer lays nothing out, so a layout the test does not send never happens, as on a device that
// never lays the probe out).

/** The ERROR for a face whose line drew at the fallback's width: the face, the width, and the file React Native looked for. */
const fellBack = (face: string, width: number) =>
  `font "${face}" is not applied: its calibration line drew at ${width} dp, the width of the fallback face, so React Native did not find fonts/${face}.ttf in the APK's assets`;

type Rect = { x: number; y: number; w: number; h: number };
const RECTS: Record<string, Rect> = { 'probe-stage': { x: 0, y: 0, w: 400, h: 800 } };

/** A scene with one probe that draws a line in each face it declares (a page under test, in miniature). */
function scene(fonts: readonly string[]): Record<string, Scene> {
  const Page = () => (
    <Probe id="stage">
      {fonts.map((f) => <Text key={f} style={{ fontFamily: f }}>שלום</Text>)}
    </Probe>
  );
  return { smoke: { periodMs: 6000, probes: ['stage'], fonts: fonts as readonly LabFaceId[], Component: Page } };
}

function setup(deps: Record<string, unknown> = {}, labArgs: Record<string, string> = { run: 'r1', scene: 'smoke', clock: 'fixed', t: '0', frames: '2' }) {
  const lines: string[] = [];
  const emitter = new EventEmitter();
  const frames = {
    queue: [] as Array<() => void>,
    next(cb: () => void) { frames.queue.push(cb); return () => { frames.queue = frames.queue.filter((x) => x !== cb); }; },
    tick(n = 1) { for (let i = 0; i < n; i += 1) { const due = frames.queue; frames.queue = []; due.forEach((cb) => cb()); } },
  };
  const events = {
    addListener: (name: string, cb: (e: unknown) => void) => { emitter.on(name, cb); return { remove: () => emitter.off(name, cb) }; },
  };
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow')
    .mockImplementation(function (this: { props: { nativeID?: string } }, cb: unknown) {
      const r = RECTS[this.props.nativeID ?? ''] ?? { x: 1, y: 2, w: 3, h: 4 };
      (cb as (...v: number[]) => void)(r.x, r.y, r.w, r.h);
    });
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <LabRoot labArgs={labArgs} nonStringKeys={[]} powerSave={false} deps={{ emit: (l: string) => lines.push(l), frames, events, ...deps }} />,
    );
  });
  mounts.track(tree);
  const of = (kind: string) => lines.filter((l) => l.startsWith(`KOKONADA_LAB ${kind} `)).map((l) => JSON.parse(l.slice(`KOKONADA_LAB ${kind} `.length)));
  /** Lays out the scene's own probes (the stage), as the device does at first layout. */
  const layoutScene = () => act(() => {
    for (const p of tree.root.findAll((n) => typeof n.type === 'string' && String(n.props.nativeID ?? '').startsWith('probe-'))) {
      p.props.onLayout({ nativeEvent: { layout: {} } });
    }
  });
  const fontProbes = () => tree.root.findAll((n) => typeof n.type === 'string' && String(n.props.testID ?? '').startsWith('lab-font-probe:'));
  /** React Native measured the calibration line of `probe` (a face, or the fallback) at `width` dp. */
  const drew = (probe: string, width: number) => act(() => {
    const node = fontProbes().find((n) => n.props.testID === `lab-font-probe:${probe}`);
    if (!node) throw new Error(`no font probe for ${probe}`);
    node.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 40 } } });
  });
  const tick = (n = 1) => act(() => frames.tick(n));
  const command = (args: Record<string, unknown>) => act(() => { emitter.emit(LAB_EVENTS.command, { args, nonStringKeys: [] }); });
  return { tree, lines, of, layoutScene, fontProbes, drew, tick, command };
}

afterEach(() => jest.restoreAllMocks());

describe('a scene that declares no fonts (UI-072)', () => {
  it('renders no font probe and sends READY after its probes and N frames, as before', () => {
    const h = setup();
    expect(h.fontProbes()).toEqual([]);
    h.layoutScene();
    h.tick(2);
    expect(h.of('READY')).toHaveLength(1);
    expect(h.of('ERROR')).toEqual([]);
  });
});

describe('a scene with fonts waits for React Native to draw each one (UI-072)', () => {
  it('no READY until every face and the fallback have drawn, however many frames go by', () => {
    const h = setup({ scenes: scene(['Heebo-Regular', 'Bellefair-Regular']) });
    h.layoutScene();
    h.tick(50);
    expect(h.of('READY')).toEqual([]);
    h.drew('Heebo-Regular', 413.5);
    h.drew(FALLBACK_PROBE, 395.25);
    h.tick(50);
    expect(h.of('READY')).toEqual([]); // Bellefair has not drawn yet
    h.drew('Bellefair-Regular', 302);
    h.tick(1);
    expect(h.of('READY')).toEqual([]); // 1 of 2 frames, counted from when the fonts were known
    h.tick(1);
    expect(h.of('READY')).toHaveLength(1);
    expect(h.of('ERROR')).toEqual([]);
  });

  it('the order of the layouts does not matter: the fallback first, then the faces', () => {
    const h = setup({ scenes: scene(['Heebo-Light']) });
    h.drew(FALLBACK_PROBE, 395.25);
    h.drew('Heebo-Light', 401.75);
    h.layoutScene();
    h.tick(2);
    expect(h.of('READY')).toHaveLength(1);
  });

  it('a face that drew at the fallback\'s width is not in the APK: one ERROR naming it and its file, and never READY', () => {
    const h = setup({ scenes: scene(['Heebo-Regular']) });
    h.layoutScene();
    h.drew(FALLBACK_PROBE, 395.25);
    h.drew('Heebo-Regular', 395.25);
    h.tick(10);
    expect(h.of('ERROR')).toEqual([{ run: 'r1', errors: [fellBack('Heebo-Regular', 395.25)] }]);
    expect(h.of('READY')).toEqual([]);
  });

  it('each face is judged on its own: an applied face does not cover one that fell back', () => {
    const h = setup({ scenes: scene(['Heebo-Regular', 'Bellefair-Regular']) });
    h.layoutScene();
    h.drew('Heebo-Regular', 413.5);
    h.drew(FALLBACK_PROBE, 395.25);
    h.drew('Bellefair-Regular', 395.25);
    h.tick(10);
    expect(h.of('ERROR')).toEqual([{ run: 'r1', errors: [fellBack('Bellefair-Regular', 395.25)] }]);
    expect(h.of('READY')).toEqual([]);
  });

  it('a width under a dp from the fallback\'s is the fallback (layout rounds to the pixel), and a dp or more is a face', () => {
    const near = setup({ scenes: scene(['Heebo-Light']) });
    near.layoutScene();
    near.drew(FALLBACK_PROBE, 395.25);
    near.drew('Heebo-Light', 396.2);
    near.tick(10);
    expect(near.of('ERROR')).toHaveLength(1);
    expect(near.of('READY')).toEqual([]);

    const apart = setup({ scenes: scene(['Heebo-Light']) });
    apart.layoutScene();
    apart.drew(FALLBACK_PROBE, 395.25);
    apart.drew('Heebo-Light', 396.25);
    apart.tick(2);
    expect(apart.of('ERROR')).toEqual([]);
    expect(apart.of('READY')).toHaveLength(1);
  });

  it('a width that is not a finite number is an ERROR naming the probe, never a verdict', () => {
    const h = setup({ scenes: scene(['Heebo-Regular']) });
    h.layoutScene();
    h.drew(FALLBACK_PROBE, 395.25);
    h.drew('Heebo-Regular', Number.NaN);
    h.tick(10);
    expect(h.of('ERROR')).toEqual([{ run: 'r1', errors: ['the font probe "Heebo-Regular" reported a width that is not a finite number (NaN)'] }]);
    expect(h.of('READY')).toEqual([]);
  });

  it('a layout that comes again after the verdict changes nothing: one READY, no ERROR', () => {
    const h = setup({ scenes: scene(['Heebo-Regular']) });
    h.layoutScene();
    h.drew(FALLBACK_PROBE, 395.25);
    h.drew('Heebo-Regular', 413.5);
    h.tick(2);
    h.drew('Heebo-Regular', 395.25);
    h.tick(10);
    expect(h.of('READY')).toHaveLength(1);
    expect(h.of('ERROR')).toEqual([]);
  });

  it('a stepped scene judges its fonts once: a step\'s READY does not wait for them again', () => {
    const h = setup({ scenes: scene(['Heebo-Regular']) }, { run: 'r2', scene: 'smoke', clock: 'stepped', t: '0', stepMs: '250', frames: '2' });
    h.layoutScene();
    h.drew(FALLBACK_PROBE, 395.25);
    h.drew('Heebo-Regular', 413.5);
    h.tick(2);
    expect(h.of('READY')).toHaveLength(1);
    h.command({ seq: '1', cmd: 'step' });
    h.tick(2);
    expect(h.of('READY').map((r) => [r.seq, r.t])).toEqual([[0, 0], [1, 250]]);
    expect(h.of('ERROR')).toEqual([]);
  });
});

describe('a scene that declares a face the lab does not have', () => {
  it('is one ERROR at once, naming it, and never READY', () => {
    const h = setup({ scenes: scene(['Nope-Regular']) });
    h.layoutScene();
    h.tick(10);
    expect(h.of('ERROR')).toEqual([{ run: 'r1', errors: ['the scene declares a font that is not a lab face (fonts.ts LAB_FACES): "Nope-Regular"'] }]);
    expect(h.of('READY')).toEqual([]);
  });
});

describe('the constant is gone (UI-072)', () => {
  it('fontsReady: true in the dependencies does not send READY for a scene whose fonts have not drawn', () => {
    const h = setup({ fontsReady: true, scenes: scene(['Heebo-Regular']) });
    h.layoutScene();
    h.tick(50);
    expect(h.of('READY')).toEqual([]);
  });

  it('fontsReady: false in the dependencies does not hold READY for a scene with no fonts', () => {
    const h = setup({ fontsReady: false });
    h.layoutScene();
    h.tick(2);
    expect(h.of('READY')).toHaveLength(1);
  });
});

describe('the font probes', () => {
  const probes = () => {
    const h = setup({ scenes: scene(['Heebo-Medium', 'Bellefair-Regular']) });
    return h.fontProbes();
  };

  it('one per declared face and one for the fallback, each the same Hebrew line in its face', () => {
    const found = probes();
    expect(found.map((n) => n.props.testID).sort()).toEqual(['lab-font-probe:Bellefair-Regular', 'lab-font-probe:Heebo-Medium', `lab-font-probe:${FALLBACK_PROBE}`]);
    const familyOf = (n: (typeof found)[number]) => StyleSheet.flatten(n.props.style).fontFamily;
    expect(Object.fromEntries(found.map((n) => [n.props.testID, familyOf(n)]))).toEqual({
      'lab-font-probe:Heebo-Medium': 'Heebo-Medium',
      'lab-font-probe:Bellefair-Regular': 'Bellefair-Regular',
      [`lab-font-probe:${FALLBACK_PROBE}`]: MISSING_FACE,
    });
    for (const n of found) expect(n.props.children).toBe(CALIBRATION_TEXT);
  });

  it('measure the same way: no weight, no font scaling, one line, all at one origin (so the fallback\'s pixel rounding is the same)', () => {
    for (const n of probes()) {
      const style = StyleSheet.flatten(n.props.style);
      expect(n.props.allowFontScaling).toBe(false);
      expect(n.props.numberOfLines).toBe(1);
      expect(style.fontWeight).toBeUndefined();
      expect(style).toMatchObject({ position: 'absolute', left: 0, top: 0 });
    }
  });

  it('are never seen: invisible to the capture, hidden from TalkBack, untouchable, and never a lab probe', () => {
    const h = setup({ scenes: scene(['Heebo-Medium', 'Bellefair-Regular']) });
    const found = h.fontProbes();
    for (const n of found) expect(n.props.nativeID).toBeUndefined();
    const boxes = h.tree.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'lab-font-probes');
    expect(boxes).toHaveLength(1);
    const [box] = boxes;
    expect(box.findAll((n) => typeof n.type === 'string' && String(n.props.testID ?? '').startsWith('lab-font-probe:'))).toHaveLength(found.length);
    expect(StyleSheet.flatten(box.props.style)).toMatchObject({ position: 'absolute', opacity: 0 });
    expect(box.props.pointerEvents).toBe('none');
    expect(box.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(box.props.accessibilityElementsHidden).toBe(true);
    expect(box.props.nativeID).toBeUndefined();
  });
});

describe('a font probe that never lays out (UI-072, the setting-read deadline)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('is one ERROR at the deadline, naming what never drew, and never READY', () => {
    const h = setup({ scenes: scene(['Heebo-Regular', 'Bellefair-Regular']) });
    h.layoutScene();
    h.drew('Heebo-Regular', 413.5);
    act(() => { jest.advanceTimersByTime(FONT_CHECK_DEADLINE_MS - 1); });
    expect(h.of('ERROR')).toEqual([]);
    act(() => { jest.advanceTimersByTime(1); });
    expect(h.of('ERROR')).toEqual([{ run: 'r1', errors: [
      `the font probes did not lay out within ${FONT_CHECK_DEADLINE_MS} ms: "Bellefair-Regular", the fallback`,
    ] }]);
    h.tick(10);
    expect(h.of('READY')).toEqual([]);
  });

  it('the deadline is cleared once the fonts are judged: nothing fires later', () => {
    const h = setup({ scenes: scene(['Heebo-Regular']) });
    h.layoutScene();
    h.drew(FALLBACK_PROBE, 395.25);
    h.drew('Heebo-Regular', 413.5);
    h.tick(2);
    act(() => { jest.advanceTimersByTime(5 * FONT_CHECK_DEADLINE_MS); });
    expect(h.of('READY')).toHaveLength(1);
    expect(h.of('ERROR')).toEqual([]);
  });
});

// F10 G8 (F6): the token faces are retired. The v2 components set their text in their faces' own files, so a family at
// a weight (Heebo@600, what React Native on Android cannot find) is no face a scene may declare: one ERROR naming it.
describe('a scene that declares a family at a weight (F10 G8)', () => {
  it('is one ERROR at once, naming it, and never READY', () => {
    const h = setup({ scenes: scene(['Heebo@600']) });
    h.layoutScene();
    h.tick(10);
    expect(h.of('ERROR')).toEqual([{ run: 'r1', errors: ['the scene declares a font that is not a lab face (fonts.ts LAB_FACES): "Heebo@600"'] }]);
    expect(h.of('READY')).toEqual([]);
  });
});
