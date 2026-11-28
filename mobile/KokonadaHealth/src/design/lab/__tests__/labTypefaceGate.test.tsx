import React from 'react';
import { EventEmitter } from 'events';
import { Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { BUNDLED_FACES } from '../../v2/typeface/faces';
import { TypefaceProvider, useTypefaceFontMgr } from '../../v2/typeface/TypefaceProvider';
import { V2_FACE_SOURCES } from '../../v2FaceSources';
import { FONT_CHECK_DEADLINE_MS } from '../fonts';
import { LabRoot } from '../LabRoot';
import { Probe } from '../probe/Probe';
import type { Scene } from '../scenes';
import { labMounts } from './__fixtures__/labMounts';

// Every LabRoot here is unmounted after its test, and no timer the lab armed may outlive it (UI-261).
const mounts = labMounts();
// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load (__fixtures__/skiaHeadless.ts); the same
// fixture fakes the part of Skia the typeface provider builds its font manager with.
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());
// Jest cannot load a font file (the preset transforms images only), so the app's face sources are each face registered
// as the Metro asset require('…/assets/fonts/<id>.ttf') makes on the device (TypefaceProvider.test.tsx does the same).
jest.mock('../../v2FaceSources', () => {
  // The registry Metro registers an asset in: from React Native 0.88, react-native's own AssetRegistry.
  const mockRegistry = require('react-native').AssetRegistry;
  const ids = ['Heebo-Light', 'Heebo-Regular', 'Heebo-Medium', 'Heebo-SemiBold', 'Bellefair-Regular'];
  const asset = (name: string) => mockRegistry.registerAsset({ __packager_asset: true, httpServerLocation: '/assets/assets/fonts', name, type: 'ttf', scales: [1], hash: name, fileSystemLocation: '/assets/fonts' });
  return { V2_FACE_SOURCES: Object.fromEntries(ids.map((id) => [id, asset(id)])) };
});

// F10 G8 (F6): a scene that draws Skia text (the hero's RimLabels) needs the bundled faces in a Skia font manager, which
// v2's TypefaceProvider loads and useTypefaceFontMgr hands down. Without it, Skia on Android answers a typeface with no
// glyphs and the rim words draw nothing, so a READY before the faces are in would be a READY over missing text. A scene
// asks for it (`typefaces: true`); LabRoot then mounts the provider above the scene, with the app's face sources, and
// READY waits until the font manager is in. A face that cannot load is one ERROR naming it, and so is a manager that is
// not in by the font deadline: never a silent wait. The real provider and loader run; only Skia and the readers are faked
// (the reader resolves when the test says), as TypefaceProvider.test.tsx fakes them.

type Pending = { source: unknown; resolve: () => void; reject: (e: Error) => void };

/** A face reader that answers when the test says: each read is held until released. */
function heldReader() {
  const pending: Pending[] = [];
  const read = (source: unknown) => new Promise<{ dispose(): void }>((resolve, reject) => {
    pending.push({ source, resolve: () => resolve({ dispose() {} }), reject });
  });
  const release = () => act(async () => { for (const p of pending.splice(0)) p.resolve(); });
  const refuse = (message: string) => act(async () => { for (const p of pending.splice(0)) p.reject(new Error(message)); });
  return { read, pending, release, refuse };
}

const seenMgr: unknown[] = [];
/** A scene that reads the font manager, as RimLabels does, and draws one probe. */
function SkiaTextScene() {
  seenMgr.push(useTypefaceFontMgr());
  return <Probe id="stage"><Text>rim</Text></Probe>;
}
const scenesOf = (typefaces: boolean): Record<string, Scene> => ({
  smoke: { periodMs: 6000, probes: ['stage'], ...(typefaces ? { typefaces: true as const } : {}), Component: SkiaTextScene },
});

function setup(scenes: Record<string, Scene>, typefaces?: { sources: unknown; read: (s: unknown) => Promise<unknown> }) {
  const lines: string[] = [];
  const emitter = new EventEmitter();
  const frames = {
    queue: [] as Array<() => void>,
    next(cb: () => void) { frames.queue.push(cb); return () => { frames.queue = frames.queue.filter((x) => x !== cb); }; },
    tick(n = 1) { for (let i = 0; i < n; i += 1) { const due = frames.queue; frames.queue = []; due.forEach((cb) => cb()); } },
  };
  const events = { addListener: (name: string, cb: (e: unknown) => void) => { emitter.on(name, cb); return { remove: () => emitter.off(name, cb) }; } };
  const reduceMotion = { current: () => new Promise<boolean>(() => {}), subscribe: () => () => {} };
  jest.spyOn(View.prototype as never as { measureInWindow(cb: unknown): void }, 'measureInWindow').mockImplementation((cb: unknown) => (cb as (...v: number[]) => void)(0, 0, 411, 914));
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <LabRoot
        labArgs={{ run: 'r1', scene: 'smoke', clock: 'fixed', t: '0', frames: '2' }}
        nonStringKeys={[]}
        powerSave={false}
        deps={{ emit: (l: string) => lines.push(l), frames, events, reduceMotion, scenes, ...(typefaces ? { typefaces } : {}) } as never}
      />,
    );
  });
  mounts.track(tree);
  const of = (kind: string) => lines.filter((l) => l.startsWith(`KOKONADA_LAB ${kind} `)).map((l) => JSON.parse(l.slice(`KOKONADA_LAB ${kind} `.length)));
  const layoutScene = () => act(() => {
    for (const p of tree.root.findAll((n) => typeof n.type === 'string' && String(n.props.nativeID ?? '').startsWith('probe-'))) p.props.onLayout({ nativeEvent: { layout: {} } });
  });
  return { tree, of, layoutScene, tick: (n = 1) => act(() => frames.tick(n)) };
}

const fakeSources = Object.fromEntries(BUNDLED_FACES.map((f) => [f.id, `src:${f.id}`]));

beforeEach(() => { seenMgr.length = 0; });
afterEach(() => jest.restoreAllMocks());

describe('a scene that draws no Skia text (no `typefaces`)', () => {
  it('mounts no typeface provider, and READY comes after its probes and frames, as before', () => {
    const h = setup(scenesOf(false));
    expect(h.tree.root.findAllByType(TypefaceProvider)).toEqual([]);
    h.layoutScene();
    h.tick(2);
    expect(h.of('READY')).toHaveLength(1);
  });
});

describe('a scene that draws Skia text (`typefaces: true`)', () => {
  it('is mounted under the typeface provider, with the app\'s own face sources unless a test gives others', async () => {
    const plain = setup(scenesOf(true));
    expect(plain.tree.root.findByType(TypefaceProvider).props.sources).toBe(V2_FACE_SOURCES);
    await act(async () => {}); // the app's sources load through the asset reader, headless: the manager comes in
    expect(seenMgr[seenMgr.length - 1]).toBeDefined();
    const reader = heldReader();
    const given = setup(scenesOf(true), { sources: fakeSources, read: reader.read });
    expect(given.tree.root.findByType(TypefaceProvider).props).toMatchObject({ sources: fakeSources, read: reader.read });
  });

  it('READY waits until the font manager is in, however many frames go by, and the scene reads that manager', async () => {
    const reader = heldReader();
    const h = setup(scenesOf(true), { sources: fakeSources, read: reader.read });
    h.layoutScene();
    h.tick(50);
    expect(h.of('READY')).toEqual([]);
    expect(seenMgr.every((m) => m === undefined)).toBe(true);
    expect(reader.pending.map((p) => p.source).sort()).toEqual(Object.values(fakeSources).sort());
    await reader.release();
    h.tick(1);
    expect(h.of('READY')).toEqual([]); // 1 of 2 frames, counted from when the faces were in
    h.tick(1);
    expect(h.of('READY')).toHaveLength(1);
    expect(h.of('ERROR')).toEqual([]);
    expect(seenMgr[seenMgr.length - 1]).toBeDefined();
  });

  it('a face that cannot load is one ERROR naming it, and never READY', async () => {
    // React reports the provider's throw to the console as it reaches the boundary; the ERROR line is what is judged.
    const reported = jest.spyOn(console, 'error').mockImplementation(() => {});
    const reader = heldReader();
    const h = setup(scenesOf(true), { sources: fakeSources, read: reader.read });
    h.layoutScene();
    await reader.refuse('no such file: src:Heebo-Medium');
    expect(reported).toHaveBeenCalled();
    h.tick(10);
    expect(h.of('ERROR')).toEqual([{ run: 'r1', errors: ['the typeface provider could not load the bundled faces: no such file: src:Heebo-Medium'] }]);
    expect(h.of('READY')).toEqual([]);
  });

  describe('at the font deadline', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('a font manager that is not in is one ERROR naming it, and never READY', () => {
      const reader = heldReader();
      const h = setup(scenesOf(true), { sources: fakeSources, read: reader.read });
      h.layoutScene();
      act(() => { jest.advanceTimersByTime(FONT_CHECK_DEADLINE_MS - 1); });
      expect(h.of('ERROR')).toEqual([]);
      act(() => { jest.advanceTimersByTime(1); });
      expect(h.of('ERROR')).toEqual([{ run: 'r1', errors: [`the typeface provider's font manager was not in within ${FONT_CHECK_DEADLINE_MS} ms`] }]);
      h.tick(10);
      expect(h.of('READY')).toEqual([]);
    });
  });
});
