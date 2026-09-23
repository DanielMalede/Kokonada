import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { AccessibilityInfo, Keyboard } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, { addTap, setActivity, setTextPrompt } from '../../../state/cold/emotionSlice';
import { GenerateScreen } from '../GenerateScreen';
import { RadialWheel } from '../../wheel/RadialWheel';
import { BioAura } from '../../aura/BioAura';
import { EmotionListSelector } from '../EmotionListSelector';
import { generationStatusStore } from '../generationStatusStore';
import { playbackErrorStore } from '../../playback/playbackErrorStore';
import { liveModeStore } from '../liveModeStore';
import { warmStore } from '../../../state/store';
import { colors, space, type as typography, type ThemeName } from '../../../design/tokens';
import { contrastRatio, AA_NORMAL } from '../../../design/contrast';
import { textScrimFill } from '../../../design/auroraSurfaces';
import { AI_DISCLOSURE_LONG } from '../../../legal/legalCopy';
import { LegalNote } from '../../../legal/LegalNote';

// The HERO composition (single writer, last in the DAG). The sacred emotion→socket→playlist loop
// stays byte-for-byte (T9 pins the payloads); here we pin the SURFACE contract: 4-state CTA, undo/
// clear, tap-most-recent-dot, mini-ring on keyboard focus, full-bleed Genesis gated on generating,
// soft inline retry (never a toast), light+dark tokenisation, and — ATTACK-6 EXTENDED — every
// subscription torn down on unmount.

const makeStore = () => configureStore({ reducer: { emotion: emotionReducer } });
const makeSocket = () => ({ requestPlaylist: jest.fn(() => 1), requestHeartPlaylist: jest.fn(() => 2), syncLiveMode: jest.fn() });

async function mount(scheme: ThemeName, store: ReturnType<typeof makeStore>, socket: any) {
  jest.spyOn(RN, 'useColorScheme').mockReturnValue(scheme);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Provider store={store}><GenerateScreen socket={socket} /></Provider>);
  });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  return tree;
}
const byId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];
const label = (tree: ReactTestRenderer.ReactTestRenderer) => byId(tree, 'generate-cta-label').props.children;
const flat = (node: any) => RN.StyleSheet.flatten(node.props.style) as any;

beforeEach(() => {
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
  warmStore.getState().reset();
  liveModeStore.getState().setLiveMode(false);
  generationStatusStore.getState().settle();
  playbackErrorStore.getState().clear();
});
afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    generationStatusStore.getState().settle();
    playbackErrorStore.getState().clear();
    liveModeStore.getState().setLiveMode(false);
    warmStore.getState().reset(); // setLiveHr(null) is a no-op (plausibility guard) — reset the singleton
  });
  jest.restoreAllMocks();
});

describe('GenerateScreen — 4-state morphing CTA', () => {
  it('disabled with no taps / activity / prompt / HR (inert, not tinted)', async () => {
    const tree = await mount('dark', makeStore(), makeSocket());
    expect(label(tree)).toBe('Generate');
    expect(byId(tree, 'generate-cta').props.accessibilityState.disabled).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('"Generate" (reactive) whenever emotion input exists', async () => {
    const store = makeStore();
    const tree = await mount('dark', store, makeSocket());
    await ReactTestRenderer.act(async () => { store.dispatch(setActivity('running')); });
    expect(label(tree)).toBe('Generate');
    expect(byId(tree, 'generate-cta').props.accessibilityState.disabled).toBe(false);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('"Listen to your heart" when only a live HR is present', async () => {
    warmStore.getState().setLiveHr(78);
    const tree = await mount('dark', makeStore(), makeSocket());
    expect(label(tree)).toBe('Listen to your heart');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('"Live-tuned" passive status (disabled) when Live mode is on', async () => {
    liveModeStore.getState().setLiveMode(true);
    const tree = await mount('dark', makeStore(), makeSocket());
    expect(label(tree)).toBe('Live-tuned');
    expect(byId(tree, 'generate-cta').props.accessibilityState.disabled).toBe(true);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('GenerateScreen — submit fires the right socket request, disabled/live-tuned fire none', () => {
  it('generate mode requests a playlist', async () => {
    const store = makeStore();
    const socket = makeSocket();
    const tree = await mount('dark', store, socket);
    await ReactTestRenderer.act(async () => { store.dispatch(setTextPrompt('rainy')); });
    await ReactTestRenderer.act(async () => { byId(tree, 'generate-cta').props.onPress(); });
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('disabled CTA fires no socket request', async () => {
    const socket = makeSocket();
    const tree = await mount('dark', makeStore(), socket);
    await ReactTestRenderer.act(async () => { byId(tree, 'generate-cta').props.onPress?.(); });
    expect(socket.requestPlaylist).not.toHaveBeenCalled();
    expect(socket.requestHeartPlaylist).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('live-tuned CTA fires no socket request (both cannot drive the queue)', async () => {
    liveModeStore.getState().setLiveMode(true);
    const store = makeStore();
    const socket = makeSocket();
    const tree = await mount('dark', store, socket);
    await ReactTestRenderer.act(async () => { store.dispatch(setActivity('running')); });
    await ReactTestRenderer.act(async () => { byId(tree, 'generate-cta').props.onPress?.(); });
    expect(socket.requestPlaylist).not.toHaveBeenCalled();
    expect(socket.requestHeartPlaylist).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('GenerateScreen — undo / clear controls (§5) preserve activity + prompt', () => {
  it('undo removes the most-recent tap; clear empties taps but keeps activity + prompt', async () => {
    const store = makeStore();
    const tree = await mount('dark', store, makeSocket());
    await ReactTestRenderer.act(async () => {
      store.dispatch(addTap({ x: 0.5, y: 0.5 }));
      store.dispatch(addTap({ x: -0.3, y: 0.4 }));
      store.dispatch(setActivity('focus'));
      store.dispatch(setTextPrompt('deep work'));
    });
    await ReactTestRenderer.act(async () => { byId(tree, 'generate-undo').props.onPress(); });
    expect(store.getState().emotion.taps).toEqual([{ x: 0.5, y: 0.5 }]);
    await ReactTestRenderer.act(async () => { byId(tree, 'generate-clear').props.onPress(); });
    expect(store.getState().emotion.taps).toEqual([]);
    expect(store.getState().emotion.activity).toBe('focus');
    expect(store.getState().emotion.textPrompt).toBe('deep work');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the wheel reflects the store taps and re-tinting flows from them (single source of truth)', async () => {
    const store = makeStore();
    const tree = await mount('dark', store, makeSocket());
    await ReactTestRenderer.act(async () => { store.dispatch(addTap({ x: -0.6, y: 0.6 })); }); // intense
    const wheel = tree.root.findByType(RadialWheel);
    expect(wheel.props.committedTaps).toEqual([{ x: -0.6, y: 0.6 }]);
    expect(wheel.props.accentInk).toBe(colors.dark.emotionAccent.intense.ink); // reactive tint
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('GenerateScreen — mini-ring on keyboard focus (Fork 3A)', () => {
  it('shrinks the wheel while the prompt is focused and restores it on blur', async () => {
    const tree = await mount('dark', makeStore(), makeSocket());
    const full = tree.root.findByType(RadialWheel).props.size;
    const promptInput = tree.root.findByType(RN.TextInput);
    await ReactTestRenderer.act(async () => { promptInput.props.onFocus(); });
    const mini = tree.root.findByType(RadialWheel).props.size;
    expect(mini).toBeLessThan(full);
    await ReactTestRenderer.act(async () => { promptInput.props.onBlur(); });
    expect(tree.root.findByType(RadialWheel).props.size).toBe(full);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('GenerateScreen — aura is restored (A1: scaled + behind the wheel, visible halo)', () => {
  it('renders BioAura at AURA_SCALE (1.6×) so the bloom overspills the opaque disc', async () => {
    const tree = await mount('dark', makeStore(), makeSocket());
    const wheel = tree.root.findByType(RadialWheel);
    const aura = tree.root.findByType(BioAura);
    expect(aura.props.size).toBeCloseTo(wheel.props.size * 1.6);
    expect(aura.props.size).toBeGreaterThan(wheel.props.size); // halo extends beyond the disc rim
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('GenerateScreen — full-bleed Genesis (gated, blocks input, success-exhale hold, reduced static)', () => {
  it('appears ONLY while generating and captures touches (blocks stray input)', async () => {
    const tree = await mount('dark', makeStore(), makeSocket());
    expect(byId(tree, 'genesis-overlay')).toBeFalsy();
    await ReactTestRenderer.act(async () => { generationStatusStore.getState().begin(); });
    const overlay = byId(tree, 'genesis-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.props.pointerEvents).toBe('auto'); // scrim captures touches mid-generation
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('HOLDS the overlay through a resolving exhale beat after generating ends (so the exit plays)', async () => {
    const tree = await mount('dark', makeStore(), makeSocket());
    await ReactTestRenderer.act(async () => { generationStatusStore.getState().begin(); });
    await ReactTestRenderer.act(async () => { generationStatusStore.getState().settle(); });
    // still mounted (resolving beat) so NeuralAnalysisLoader's spring exit can exhale, input still blocked
    expect(byId(tree, 'genesis-overlay')).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('reduced motion cuts straight out on settle — no exhale hold (static path)', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(true);
    const tree = await mount('dark', makeStore(), makeSocket());
    await ReactTestRenderer.act(async () => { generationStatusStore.getState().begin(); });
    await ReactTestRenderer.act(async () => { generationStatusStore.getState().settle(); });
    expect(byId(tree, 'genesis-overlay')).toBeFalsy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('themes the scrim for pearl depth — surface.base (dark) / surface.overlay (light)', async () => {
    const dark = await mount('dark', makeStore(), makeSocket());
    await ReactTestRenderer.act(async () => { generationStatusStore.getState().begin(); });
    expect(flat(byId(dark, 'genesis-overlay')).backgroundColor).toBe(colors.dark.surface.base);
    await ReactTestRenderer.act(async () => { dark.unmount(); });
    generationStatusStore.getState().settle();

    const light = await mount('light', makeStore(), makeSocket());
    await ReactTestRenderer.act(async () => { generationStatusStore.getState().begin(); });
    expect(flat(byId(light, 'genesis-overlay')).backgroundColor).toBe(colors.light.surface.overlay);
    await ReactTestRenderer.act(async () => { light.unmount(); });
  });
});

describe('GenerateScreen — soft inline retry on failure (Fork 4A, NEVER a toast)', () => {
  it('renders an in-surface honest line + Retry when the error store has a message', async () => {
    const store = makeStore();
    const socket = makeSocket();
    const tree = await mount('dark', store, socket);
    await ReactTestRenderer.act(async () => { store.dispatch(setActivity('running')); });
    await ReactTestRenderer.act(async () => { playbackErrorStore.getState().set('Could not generate a playlist — try again'); });
    expect(byId(tree, 'generate-error')).toBeTruthy();               // inline, on the surface
    await ReactTestRenderer.act(async () => { byId(tree, 'generate-retry').props.onPress(); });
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(1);         // Retry re-submits
    expect(playbackErrorStore.getState().message).toBeNull();        // and clears the error
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('the Retry label uses content.secondary — AA-normal on base in LIGHT, not the sub-AA accent.glow', async () => {
    const store = makeStore();
    const tree = await mount('light', store, makeSocket());
    await ReactTestRenderer.act(async () => { store.dispatch(setActivity('running')); });
    await ReactTestRenderer.act(async () => { playbackErrorStore.getState().set('err'); });
    const color = flat(byId(tree, 'generate-retry-label')).color;
    expect(color).toBe(colors.light.content.secondary);
    expect(contrastRatio(color, colors.light.surface.base)).toBeGreaterThanOrEqual(AA_NORMAL);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('GenerateScreen — renders light AND dark', () => {
  it('mounts cleanly in both schemes', async () => {
    const dark = await mount('dark', makeStore(), makeSocket());
    expect(byId(dark, 'generate-cta')).toBeTruthy();
    await ReactTestRenderer.act(async () => { dark.unmount(); });
    const light = await mount('light', makeStore(), makeSocket());
    expect(byId(light, 'generate-cta')).toBeTruthy();
    await ReactTestRenderer.act(async () => { light.unmount(); });
  });

});

describe('GenerateScreen — quadrant words: teach the map, then LINGER as a frosted blur once tapped (Bug 1)', () => {
  it('teaches in crisp content.muted before any tap, then STAYS (not removed) as an out-of-focus blur after a point is placed', async () => {
    const store = makeStore();
    const tree = await mount('dark', store, makeSocket());
    const expected: Array<[string, string]> = [['calm', 'Calm'], ['joyful', 'Joyful'], ['intense', 'Intense'], ['reflective', 'Reflective']];
    // Teaching state (pre-tap): crisp muted ink over its own AA scrim
    for (const [q, word] of expected) {
      const w = byId(tree, `quadrant-word-${q}`);
      expect(w.props.children).toBe(word);
      expect(flat(w).color).toBe(colors.dark.content.muted);
      expect(flat(w).textShadowRadius ?? 0).toBe(0); // crisp while teaching
    }
    // Place a point → the map is learned. Daniel OVERRODE the old "retire" behavior: the words must
    // LINGER as an ambient, genuinely-out-of-focus reference behind the taps (decorative → AA waived).
    await ReactTestRenderer.act(async () => { store.dispatch(addTap({ x: 0.5, y: -0.5 })); });
    for (const [q, word] of expected) {
      const w = byId(tree, `quadrant-word-${q}`);
      expect(w).toBeTruthy();                          // STILL present (Bug 1: no longer removed)
      expect(w.props.children).toBe(word);
      const s = flat(w);
      expect(s.textShadowRadius).toBeGreaterThan(0);   // a REAL gaussian blur (Android BlurMaskFilter / iOS gaussian shadow)
      expect(s.color).toBe('transparent');             // fill hidden → only the blurred glyph shows (out of focus)
    }
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('hides the words entirely while typing (the wheel collapses to a mini-ring)', async () => {
    const store = makeStore();
    const tree = await mount('dark', store, makeSocket());
    await ReactTestRenderer.act(async () => { store.dispatch(addTap({ x: 0.5, y: -0.5 })); });
    expect(byId(tree, 'quadrant-word-calm')).toBeTruthy();  // frosted, present
    const promptInput = tree.root.findByType(RN.TextInput);
    await ReactTestRenderer.act(async () => { promptInput.props.onFocus(); });
    expect(byId(tree, 'quadrant-word-calm')).toBeFalsy();   // hidden while typing
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('GenerateScreen — undo/clear anchored to the wheel corners, zero layout shift (Bug 3)', () => {
  it('renders undo (bottom-left) + clear (bottom-right) as ABSOLUTE overlays on the wheel, never an in-flow row', async () => {
    const store = makeStore();
    const tree = await mount('dark', store, makeSocket());
    await ReactTestRenderer.act(async () => { store.dispatch(addTap({ x: 0.5, y: 0.5 })); });
    const undo = byId(tree, 'generate-undo');
    const clear = byId(tree, 'generate-clear');
    expect(undo).toBeTruthy();
    expect(clear).toBeTruthy();
    // Absolutely positioned → appearing on tap cannot push any sibling (zero layout shift = the jank fix)
    expect(flat(undo).position).toBe('absolute');
    expect(flat(clear).position).toBe('absolute');
    // opposite bottom corners of the wheel/hero
    expect(flat(undo).left).toBeDefined();
    expect(flat(undo).right).toBeUndefined();
    expect(flat(clear).right).toBeDefined();
    expect(flat(clear).left).toBeUndefined();
    expect(flat(undo).bottom).toBe(flat(clear).bottom); // same baseline row across the disc
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('hides undo/clear while typing', async () => {
    const store = makeStore();
    const tree = await mount('dark', store, makeSocket());
    await ReactTestRenderer.act(async () => { store.dispatch(addTap({ x: 0.5, y: 0.5 })); });
    const promptInput = tree.root.findByType(RN.TextInput);
    await ReactTestRenderer.act(async () => { promptInput.props.onFocus(); });
    expect(byId(tree, 'generate-undo')).toBeFalsy();
    expect(byId(tree, 'generate-clear')).toBeFalsy();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('GenerateScreen — EmotionListSelector gated behind a quiet affordance (A5b, a11y preserved)', () => {
  it('is hidden by default behind a "Choose from a list" affordance; pressing it reveals the list', async () => {
    const tree = await mount('dark', makeStore(), makeSocket());
    expect(tree.root.findAllByType(EmotionListSelector)).toHaveLength(0);
    const toggle = byId(tree, 'generate-list-toggle');
    expect(toggle).toBeTruthy();
    await ReactTestRenderer.act(async () => { toggle.props.onPress(); });
    expect(tree.root.findAllByType(EmotionListSelector).length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('auto-expands when a screen reader is enabled (full a11y preserved without a tap)', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const tree = await mount('dark', makeStore(), makeSocket());
    expect(tree.root.findAllByType(EmotionListSelector).length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});

describe('GenerateScreen — AI Act Art. 50 notice (H1 / UI-005): first frame, persistent, never tinted', () => {
  const notices = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root.findAll((n) => n.type === 'View' && n.props.testID === 'legal-note');
  const noticeText = (tree: ReactTestRenderer.ReactTestRenderer) => notices(tree)[0].findAll((n) => n.type === 'Text');
  const expectOneNotice = (tree: ReactTestRenderer.ReactTestRenderer) => {
    expect(notices(tree)).toHaveLength(1);
    const texts = noticeText(tree);
    expect(texts).toHaveLength(1);
    expect(texts[0].props.children).toBe(AI_DISCLOSURE_LONG);
  };
  // The ScrollView-level sibling that holds the notice, and its neighbours.
  const placement = (tree: ReactTestRenderer.ReactTestRenderer) => {
    let n: ReactTestRenderer.ReactTestInstance = tree.root.findByType(LegalNote);
    const holdsWheel = (x: any) => typeof x !== 'string' && x.findAllByType(RadialWheel).length > 0;
    while (n.parent && !n.parent.children.some((ch) => ch !== n && holdsWheel(ch))) n = n.parent;
    const sibs = n.parent!.children.filter((ch): ch is ReactTestRenderer.ReactTestInstance => typeof ch !== 'string');
    return {
      wrapper: n,
      iHero: sibs.findIndex(holdsWheel),
      iNotice: sibs.indexOf(n),
      iToggle: sibs.findIndex((ch) => ch.findAll((x) => x.props.accessibilityRole === 'switch').length > 0),
    };
  };
  const ancestors = (node: ReactTestRenderer.ReactTestInstance) => {
    const out: ReactTestRenderer.ReactTestInstance[] = [];
    for (let p = node.parent; p; p = p.parent) out.push(p);
    return out;
  };
  // Every tree is swept pass-or-fail: a failed assertion aborts the body before an inline unmount,
  // and a leaked tree keeps its aurora work alive — an open handle that holds jest open.
  const live: ReactTestRenderer.ReactTestRenderer[] = [];
  const open = async (scheme: ThemeName, store = makeStore()) => {
    const t = await mount(scheme, store, makeSocket());
    live.push(t);
    return t;
  };
  afterEach(async () => {
    for (const t of live.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
  });

  it.each(['light', 'dark'] as ThemeName[])('is on the FIRST frame, before any input: the LONG sentence, content.secondary on the scrim (%s)', async (face) => {
    const tree = await open(face);
    expectOneNotice(tree);
    const text = noticeText(tree)[0];
    expect(flat(text).color).toBe(colors[face].content.secondary);
    expect(flat(text).fontSize).toBeGreaterThanOrEqual(typography.size.body);
    expect(flat(notices(tree)[0]).backgroundColor).toBe(textScrimFill(colors[face], face));
  });

  it('sits directly between the hero (wheel + aura) and the Live/Manual toggle, as a ScrollView-level sibling', async () => {
    const tree = await open('dark');
    const { iHero, iNotice, iToggle } = placement(tree);
    expect(iHero).toBeGreaterThanOrEqual(0);
    expect(iNotice).toBe(iHero + 1);
    expect(iToggle).toBe(iNotice + 1);
  });

  it('spans the FULL wheel width with a 16 gap, and keeps that width while typing (never shrinks to the mini-ring)', async () => {
    const tree = await open('dark');
    const full = tree.root.findByType(RadialWheel).props.size;
    expect(flat(placement(tree).wrapper).width).toBe(full);
    expect(flat(placement(tree).wrapper).marginTop).toBe(space.lg);
    await ReactTestRenderer.act(async () => { tree.root.findByType(RN.TextInput).props.onFocus(); });
    expect(tree.root.findByType(RadialWheel).props.size).toBeLessThan(full); // the wheel DID shrink
    expect(flat(placement(tree).wrapper).width).toBe(full);                  // …the notice did not
  });

  it('stays present in every state: taps, typing, list open, error row, Live mode on', async () => {
    const store = makeStore();
    const tree = await open('dark', store);
    await ReactTestRenderer.act(async () => { store.dispatch(addTap({ x: 0.5, y: 0.5 })); store.dispatch(addTap({ x: -0.2, y: 0.3 })); store.dispatch(addTap({ x: 0.1, y: -0.4 })); });
    expectOneNotice(tree);
    await ReactTestRenderer.act(async () => { tree.root.findByType(RN.TextInput).props.onFocus(); });
    expectOneNotice(tree);
    await ReactTestRenderer.act(async () => { tree.root.findByType(RN.TextInput).props.onBlur(); });
    await ReactTestRenderer.act(async () => { byId(tree, 'generate-list-toggle').props.onPress(); });
    expectOneNotice(tree);
    await ReactTestRenderer.act(async () => { store.dispatch(setActivity('running')); playbackErrorStore.getState().set('err'); });
    expect(byId(tree, 'generate-error')).toBeTruthy();
    expectOneNotice(tree);
    await ReactTestRenderer.act(async () => { liveModeStore.getState().setLiveMode(true); });
    expect(label(tree)).toBe('Live-tuned');
    expectOneNotice(tree);
  });

  it('is NEVER tinted: identical band and ink with taps in the intense corner and in the joyful corner', async () => {
    const styleOf = async (tap: { x: number; y: number } | null) => {
      const store = makeStore();
      const tree = await open('dark', store);
      if (tap) await ReactTestRenderer.act(async () => { store.dispatch(addTap(tap)); });
      return { band: flat(notices(tree)[0]), ink: flat(noticeText(tree)[0]) };
    };
    const idle = await styleOf(null);
    const intense = await styleOf({ x: -0.8, y: 0.8 });
    const joyful = await styleOf({ x: 0.8, y: 0.8 });
    expect(intense).toEqual(joyful);
    expect(intense).toEqual(idle);
  });

  it('is reachable: no ancestor hides it from the accessibility tree, swallows its touches, or makes it a live region', async () => {
    const tree = await open('dark');
    for (const a of ancestors(notices(tree)[0])) {
      expect(a.props.pointerEvents).not.toBe('none');
      expect(a.props.accessibilityElementsHidden).not.toBe(true);
      expect(a.props.importantForAccessibility).not.toBe('no-hide-descendants');
      expect(a.props.accessibilityLiveRegion ?? 'none').toBe('none');
    }
    const text = noticeText(tree)[0];
    expect(text.props.numberOfLines).toBeUndefined();
    expect(text.props.allowFontScaling).not.toBe(false);
  });

  it('reading order: the wheel, then the notice as one node, then the Live toggle', async () => {
    const tree = await open('dark');
    const order: ReactTestRenderer.ReactTestInstance[] = [];
    const walk = (n: ReactTestRenderer.ReactTestInstance) => { order.push(n); n.children.forEach((ch) => { if (typeof ch !== 'string') walk(ch); }); };
    walk(tree.root);
    const iWheel = order.findIndex((n) => n.type === RadialWheel);
    const iNotice = order.indexOf(notices(tree)[0]);
    const iToggle = order.findIndex((n) => n.props.accessibilityRole === 'switch');
    expect(iWheel).toBeGreaterThanOrEqual(0);
    expect(iWheel).toBeLessThan(iNotice);
    expect(iNotice).toBeLessThan(iToggle);
  });
});

describe('GenerateScreen — ATTACK-6 EXTENDED: every subscription torn down on unmount', () => {
  it('warm + generationStatus + liveMode + error stores AND keyboard listeners are all cleaned up', async () => {
    const counts: Record<string, { sub: number; unsub: number }> = {};
    const spyStore = (obj: any, name: string) => {
      counts[name] = { sub: 0, unsub: 0 };
      const real = obj.subscribe.bind(obj);
      jest.spyOn(obj, 'subscribe').mockImplementation((cb: any) => {
        counts[name].sub += 1;
        const realUnsub = real(cb);
        return () => { counts[name].unsub += 1; realUnsub(); };
      });
    };
    spyStore(warmStore, 'warm');
    spyStore(generationStatusStore, 'genStatus');
    spyStore(liveModeStore, 'liveMode');
    spyStore(playbackErrorStore, 'error');
    let kbAdds = 0; let kbRemoves = 0;
    jest.spyOn(Keyboard, 'addListener').mockImplementation(() => {
      kbAdds += 1;
      return { remove: () => { kbRemoves += 1; } } as any;
    });

    const tree = await mount('dark', makeStore(), makeSocket());
    await ReactTestRenderer.act(async () => { tree.unmount(); });

    for (const [name, c] of Object.entries(counts)) {
      expect(c.sub).toBeGreaterThan(0);          // each store WAS subscribed
      expect(c.unsub).toBe(c.sub);               // …and every subscription cleaned up (${name})
      void name;
    }
    expect(kbAdds).toBeGreaterThan(0);           // keyboard listeners were added
    expect(kbRemoves).toBe(kbAdds);              // …and all removed
  });
});
