import React from 'react';
import { EventEmitter } from 'events';
import { StyleSheet, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { BASE, DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { FALLBACK_PROBE, LAB_FACES } from '../fonts';
import { LabRoot } from '../LabRoot';
import { ProbeRegistry } from '../probe/Probe';
import { SCENES } from '../scenes';
import { FONTS_SCENE_FACES, FONTS_SCENE_PROBES, FONTS_SPECIMEN, FontsScene, fontsFace } from '../scenes/FontsScene';
import { drawnFaces } from './__fixtures__/drawnFaces';
import { labMounts } from './__fixtures__/labMounts';

// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load (__fixtures__/skiaHeadless.ts).
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// UI-072 and UI-069 (F10 G8): the fonts scene draws every v2 face in itself and declares all five, so a capture shows the
// faces the APK carries, READY says each one drew in its own face, and a face missing from the APK's assets is one ERROR
// naming it and its file. End to end through the real LabRoot and the real scene: the font probes are laid out at the
// widths the test says React Native measured (the jest renderer lays nothing out), as labFontGate.test.tsx does.
const mounts = labMounts();

const paramsOf = (scene: string) => ({ run: 'r', scene, clock: 'fixed' as const, t: 0, stepMs: 0, frames: 2 });

describe('the fonts scenes', () => {
  it('are Abyss dark and light: FontsScene, the stage its one probe, every lab face its fonts', () => {
    const ids = Object.keys(SCENES).filter((id) => id.startsWith('fonts.')).sort();
    expect(ids).toEqual(['fonts.abyss.dark', 'fonts.abyss.light']);
    for (const id of ids) expect([id, SCENES[id].Component, SCENES[id].probes, SCENES[id].fonts]).toEqual([id, FontsScene, FONTS_SCENE_PROBES, FONTS_SCENE_FACES]);
    expect(FONTS_SCENE_PROBES).toEqual(['stage']);
    expect([...FONTS_SCENE_FACES].sort()).toEqual(Object.keys(LAB_FACES).sort());
    expect(fontsFace('fonts.abyss.light')).toBe('light');
    expect(() => fontsFace('fonts.abyss.dusk')).toThrow('"fonts.abyss.dusk" is not a lab fonts scene');
  });

  it.each(['dark', 'light'] as const)('%s: each face draws its id and weight, then the Hebrew alphabet and the digits, in itself, on the face\'s ground', (face) => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = ReactTestRenderer.create(<ProbeRegistry onMeasure={() => {}}><FontsScene params={paramsOf(`fonts.abyss.${face}`)} /></ProbeRegistry>); });
    mounts.track(r);
    const colour = DIRECTIONS.abyss.color[face];
    const stage = r.root.find((n) => typeof n.type === 'string' && n.props.nativeID === 'probe-stage');
    expect(StyleSheet.flatten(stage.props.style)).toMatchObject({ flex: 1, backgroundColor: colour.ground.hex });
    expect(drawnFaces(r.root)).toEqual(Object.keys(LAB_FACES).sort());
    for (const id of FONTS_SCENE_FACES) {
      const lines = r.root.find((n) => typeof n.type === 'string' && n.props.testID === `fonts-scene.${id}`).findAllByType(Text);
      expect(lines.map((n) => n.props.children)).toEqual([`${id} ${LAB_FACES[id].weight}`, ...FONTS_SPECIMEN]);
      for (const n of lines) {
        expect(StyleSheet.flatten(n.props.style)).toEqual({ fontFamily: id, fontSize: BASE.type.ui.body.hebrew.size, lineHeight: BASE.type.ui.body.hebrew.lineHeight, color: colour.text.primary.hex });
      }
    }
    // The specimen is the whole Hebrew alphabet without its finals, and the ten digits.
    const letters = FONTS_SPECIMEN.join('').replace(/[ 0-9]/g, '');
    expect([...letters].map((c) => c.codePointAt(0))).toEqual([0x5d0, 0x5d1, 0x5d2, 0x5d3, 0x5d4, 0x5d5, 0x5d6, 0x5d7, 0x5d8, 0x5d9, 0x5db, 0x5dc, 0x5de, 0x5e0, 0x5e1, 0x5e2, 0x5e4, 0x5e6, 0x5e7, 0x5e8, 0x5e9, 0x5ea]);
    expect(FONTS_SPECIMEN.join('').replace(/[^0-9]/g, '')).toBe('0123456789');
  });
});

describe('through LabRoot, READY waits for every face (UI-072)', () => {
  function setup(scene: string) {
    const lines: string[] = [];
    const emitter = new EventEmitter();
    const frames = {
      queue: [] as Array<() => void>,
      next(cb: () => void) { frames.queue.push(cb); return () => { frames.queue = frames.queue.filter((x) => x !== cb); }; },
      tick(n = 1) { for (let i = 0; i < n; i += 1) { const due = frames.queue; frames.queue = []; due.forEach((cb) => cb()); } },
    };
    const events = { addListener: (name: string, cb: (e: unknown) => void) => { emitter.on(name, cb); return { remove: () => emitter.off(name, cb) }; } };
    jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow').mockImplementation((cb: unknown) => (cb as (...v: number[]) => void)(0, 0, 411, 914));
    // A fixed clock never starts the real-time clock, so the reduced-motion read is left unanswered.
    const reduceMotion = { current: () => new Promise<boolean>(() => {}), subscribe: () => () => {} };
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <LabRoot labArgs={{ run: 'r1', scene, clock: 'fixed', t: '0', frames: '2' }} nonStringKeys={[]} powerSave={false} deps={{ emit: (l: string) => lines.push(l), frames, events, reduceMotion }} />,
      );
    });
    mounts.track(tree);
    const of = (kind: string) => lines.filter((l) => l.startsWith(`KOKONADA_LAB ${kind} `)).map((l) => JSON.parse(l.slice(`KOKONADA_LAB ${kind} `.length)));
    const layoutScene = () => act(() => {
      for (const p of tree.root.findAll((n) => typeof n.type === 'string' && String(n.props.nativeID ?? '').startsWith('probe-'))) p.props.onLayout({ nativeEvent: { layout: {} } });
    });
    const drew = (probe: string, width: number) => act(() => {
      tree.root.find((n) => typeof n.type === 'string' && n.props.testID === `lab-font-probe:${probe}`).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 40 } } });
    });
    return { of, layoutScene, drew, tick: (n = 1) => act(() => frames.tick(n)) };
  }
  afterEach(() => jest.restoreAllMocks());

  it('every face drew a dp or more from the fallback: READY, after the scene\'s frames', () => {
    const h = setup('fonts.abyss.dark');
    h.layoutScene();
    h.drew(FALLBACK_PROBE, 395.25);
    FONTS_SCENE_FACES.forEach((id, i) => h.drew(id, 400 + 3 * i));
    h.tick(2);
    expect(h.of('ERROR')).toEqual([]);
    expect(h.of('READY')).toHaveLength(1);
  });

  it('a face the APK does not carry drew at the fallback\'s width: one ERROR naming it and its file, never READY', () => {
    const h = setup('fonts.abyss.light');
    h.layoutScene();
    h.drew(FALLBACK_PROBE, 395.25);
    FONTS_SCENE_FACES.forEach((id, i) => h.drew(id, id === 'Bellefair-Regular' ? 395.25 : 400 + 3 * i));
    h.tick(10);
    expect(h.of('ERROR')).toEqual([{ run: 'r1', errors: [
      'font "Bellefair-Regular" is not applied: its calibration line drew at 395.25 dp, the width of the fallback face, so React Native did not find fonts/Bellefair-Regular.ttf in the APK\'s assets',
    ] }]);
    expect(h.of('READY')).toEqual([]);
  });
});
