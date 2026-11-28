import React from 'react';
import { Linking, Platform, StyleSheet, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { PRIVACY_POLICY_URL } from '../../../legal/legalLinks';
import { SAMPLE_ADDRESS, SAMPLE_LEGAL_DOC, SAMPLE_MARKER } from '../parts/sampleLegalDoc';
import { ProbeRegistry } from '../probe/Probe';
import { SCENES } from '../scenes';
import { LabMotionPortsContext } from '../scenes/FieldScene';
import { NOTICE_SCENE_FONTS, NoticeScene } from '../scenes/NoticeScene';
import { READER_SCENE_FONTS, ReaderScene } from '../scenes/ReaderScene';
import { WELL_HINT_LABEL, WELL_SCENE_FONTS, WellHintScene } from '../scenes/WellHintScene';
import { PARTS_ITEMS, PARTS_SCRIPTS, partsSceneId } from '../sceneGroups/parts';
import { drawnFaces } from './__fixtures__/drawnFaces';

// SCENES reaches FieldView, whose fieldImage.tsx reads Skia's FilterMode on load: the setup stub lacks it.
jest.mock('@shopify/react-native-skia', () => require('./__fixtures__/skiaHeadless').skiaHeadless());

// The F10 parts the B1 pages need before their G8 (LF3): the InlineNotice with zero, one and two actions, the LegalReader
// on the lab's sample document, and the Well's hint with its accessibility label. Each is a lab scene, ids
// `parts.abyss.<face>.<item>.<script>`, drawn on the ground with synthetic words; a press changes nothing outside it.

type Node = ReactTestRenderer.ReactTestInstance;
const isHost = (n: Node) => typeof n.type === 'string';
const unanswered = { read: () => new Promise<boolean>(() => {}), subscribe: () => () => {} };
const PORTS = { reduceMotion: unanswered, powerSave: unanswered };

function mount(id: string) {
  const Scene = SCENES[id].Component;
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <ProbeRegistry onMeasure={() => {}}>
        <LabMotionPortsContext.Provider value={PORTS}>
          <Scene clock={{ t: { value: 0 } } as never} t={0} params={{ run: 'r', scene: id, clock: 'fixed', t: 0, stepMs: 0, frames: 1 }} />
        </LabMotionPortsContext.Provider>
      </ProbeRegistry>,
      { createNodeMock: () => ({}) },
    );
  });
  const strings = () => r.root.findAllByType(Text).map((t) => textOf(t));
  const byId = (testID: string) => r.root.find((n) => isHost(n) && n.props.testID === testID);
  return { r, strings, byId, unmount: () => act(() => r.unmount()) };
}
const textOf = (n: Node): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

const openURL = Linking.openURL as unknown as jest.Mock;
beforeEach(() => openURL.mockClear());
afterEach(() => jest.restoreAllMocks());

describe('the parts scene group', () => {
  it('is every face × item × script: 2 × 3 × 2 scenes, each its item’s component, the stage its probe, its faces declared', () => {
    const ids = Object.keys(SCENES).filter((id) => id.startsWith('parts.')).sort();
    const want = ['dark', 'light'].flatMap((face) => PARTS_ITEMS.flatMap((item) => PARTS_SCRIPTS.map((script) => `parts.abyss.${face}.${item}.${script}`))).sort();
    expect(PARTS_ITEMS).toEqual(['notice', 'reader', 'well']);
    expect(PARTS_SCRIPTS).toEqual(['latin', 'hebrew']);
    expect(ids).toEqual(want);
    const component = { notice: NoticeScene, reader: ReaderScene, well: WellHintScene };
    const fonts = { notice: NOTICE_SCENE_FONTS, reader: READER_SCENE_FONTS, well: WELL_SCENE_FONTS };
    for (const id of ids) {
      const item = id.split('.')[3] as keyof typeof component;
      expect([id, SCENES[id].Component, SCENES[id].fonts]).toEqual([id, component[item], fonts[item]]);
    }
    expect(partsSceneId('light', 'reader', 'hebrew')).toBe('parts.abyss.light.reader.hebrew');
  });

  it.each(['notice', 'reader', 'well'] as const)('%s draws exactly the faces it declares, Heebo only (on Android, where the lab is captured)', (item) => {
    jest.replaceProperty(Platform, 'OS', 'android');
    for (const script of PARTS_SCRIPTS) {
      const id = partsSceneId('dark', item, script);
      const view = mount(id);
      expect([id, drawnFaces(view.r.root)]).toEqual([id, [...(SCENES[id].fonts ?? [])].sort()]);
      for (const f of drawnFaces(view.r.root)) expect(f).toMatch(/^Heebo-/);
      view.unmount();
    }
  });

  it.each(['dark', 'light'] as const)('%s: the stage paints the face’s ground', (face) => {
    const { DIRECTIONS } = require('../../v2/tokens/tokens.generated');
    for (const item of PARTS_ITEMS) {
      const view = mount(partsSceneId(face, item, 'latin'));
      const stage = view.r.root.find((n) => isHost(n) && n.props.nativeID === 'probe-stage');
      expect(StyleSheet.flatten(stage.props.style).backgroundColor).toBe(DIRECTIONS.abyss.color[face].ground.hex);
      view.unmount();
    }
  });
});

describe('the notice scene', () => {
  it.each(PARTS_SCRIPTS)('%s: three notices, with no action, one (a dismiss) and two (the link, then the dismiss), the last selectable', (script) => {
    const view = mount(partsSceneId('dark', 'notice', script));
    const notices = ['notice.none', 'notice.one', 'notice.two'].map((id) => view.byId(id));
    const actionsOf = (id: string) => view.r.root.findAll((n) => isHost(n) && /\.action\.\d+$/.test(String(n.props.testID)) && String(n.props.testID).startsWith(id)).map((n) => n.props.accessibilityRole);
    expect(notices).toHaveLength(3);
    expect([actionsOf('notice.none'), actionsOf('notice.one'), actionsOf('notice.two')]).toEqual([[], ['button'], ['link', 'button']]);
    expect(view.byId('notice.two.body').props.selectable).toBe(true);
    expect(view.byId('notice.none.body').props.selectable).toBeFalsy();
    view.unmount();
  });

  it('the two-action notice names the reserved example address, never the hosted policy, and its link opens nothing', () => {
    const view = mount(partsSceneId('dark', 'notice', 'latin'));
    expect(textOf(view.byId('notice.two.body'))).toContain(SAMPLE_ADDRESS);
    for (const s of view.strings()) expect(s).not.toContain(PRIVACY_POLICY_URL);
    for (const id of ['notice.two.action.0', 'notice.two.action.1', 'notice.one.action.0']) {
      act(() => view.r.root.find((n) => !isHost(n) && n.props.testID === id && typeof n.props.onPress === 'function').props.onPress());
    }
    expect(openURL).not.toHaveBeenCalled();
    // Each press is counted on the stage, so a capture can show it landed.
    expect(textOf(view.byId('notice.presses'))).toBe('3');
    view.unmount();
  });
});

describe('the reader scene', () => {
  it.each(PARTS_SCRIPTS)('%s: the sample document under the SAMPLE marker, the reserved address on the current-text line', (script) => {
    const view = mount(partsSceneId('dark', 'reader', script));
    expect(textOf(view.byId('legalReader.title'))).toBe(SAMPLE_LEGAL_DOC[script].title);
    expect(textOf(view.byId('reader.marker'))).toBe(SAMPLE_MARKER[script]);
    expect(textOf(view.byId('legalReader.current'))).toContain(SAMPLE_ADDRESS);
    expect(new URL(SAMPLE_ADDRESS).hostname).toMatch(/(^|\.)example\.(org|com|net)$/);
    for (const s of view.strings()) {
      expect(s).not.toContain(PRIVACY_POLICY_URL);
      expect(s).not.toContain(new URL(PRIVACY_POLICY_URL).hostname);
    }
    view.unmount();
  });

  it('the marker is ink only: ui.legal in text.secondary inside a line.control keyline, never a tint', () => {
    const { BASE, DIRECTIONS } = require('../../v2/tokens/tokens.generated');
    const view = mount(partsSceneId('light', 'reader', 'latin'));
    const c = DIRECTIONS.abyss.color.light;
    expect(StyleSheet.flatten(view.byId('reader.marker.box').props.style)).toMatchObject({ borderColor: c.line.control.hex, borderWidth: BASE.icon.stroke, alignSelf: 'stretch' });
    expect(StyleSheet.flatten(view.byId('reader.marker.box').props.style).backgroundColor).toBeUndefined();
    expect(StyleSheet.flatten(view.byId('reader.marker').props.style)).toMatchObject({ color: c.text.secondary.hex, fontSize: BASE.type.ui.legal.latin.size });
    view.unmount();
  });

  it('Close only counts: the scene stays, nothing is opened', () => {
    const view = mount(partsSceneId('dark', 'reader', 'latin'));
    act(() => view.r.root.find((n) => !isHost(n) && n.props.testID === 'legalReader.close' && typeof n.props.onPress === 'function').props.onPress());
    expect(textOf(view.byId('reader.closes'))).toBe('1');
    expect(view.byId('legalReader')).toBeDefined();
    expect(openURL).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('the Well scene', () => {
  it.each(PARTS_SCRIPTS)('%s: the button host, the hint at the start, with the hint’s accessibility label', (script) => {
    const view = mount(partsSceneId('dark', 'well', script));
    const hint = view.byId('hero.well').findAll((n) => isHost(n) && String(n.type) === 'Text')[0];
    expect(hint.props.accessibilityLabel).toBe(WELL_HINT_LABEL[script]);
    expect(StyleSheet.flatten(hint.props.style).textAlign).toBe('left');
    expect(textOf(hint)).not.toBe(WELL_HINT_LABEL[script]);
    view.unmount();
  });
});
