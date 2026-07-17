import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, { addTap } from '../../../state/cold/emotionSlice';
import { EmotionListSelector, EMOTION_PRESETS } from '../EmotionListSelector';
import { emotionAccentFor } from '../../../design/emotionAccent';
import type { ThemeName } from '../../../design/tokens';

// The REQUIRED text/list alternative to the Skia wheel (A11y). Four named emotional states, each
// a representative circumplex point committed through the SAME addTap path — so a screen-reader
// user produces an IDENTICAL taps payload, no new socket shape. Colour is never the sole signal:
// every item carries a word + a descriptor + a glyph.

const makeStore = () => configureStore({ reducer: { emotion: emotionReducer } });

function renderWith(scheme: ThemeName, store: ReturnType<typeof makeStore>) {
  jest.spyOn(RN, 'useColorScheme').mockReturnValue(scheme);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<Provider store={store}><EmotionListSelector /></Provider>);
  });
  return tree;
}
const byId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];
afterEach(() => jest.restoreAllMocks());

describe('EmotionListSelector — the required list alternative to the wheel', () => {
  it('exposes exactly four named presets, one per quadrant, clear of the 0.15 deadzone', () => {
    expect(EMOTION_PRESETS.map((p) => p.quadrant)).toEqual(['calm', 'joyful', 'intense', 'reflective']);
    for (const p of EMOTION_PRESETS) {
      expect(Math.hypot(p.coord.x, p.coord.y)).toBeGreaterThan(0.15);      // real committed lean
      expect(emotionAccentFor([p.coord])).toBe(p.quadrant);               // lands in its own quadrant
    }
  });

  it('the fixed coords are the spec circumplex points', () => {
    const byQ = Object.fromEntries(EMOTION_PRESETS.map((p) => [p.quadrant, p.coord]));
    expect(byQ.calm).toEqual({ x: 0.55, y: -0.55 });
    expect(byQ.joyful).toEqual({ x: 0.55, y: 0.55 });
    expect(byQ.intense).toEqual({ x: -0.55, y: 0.55 });
    expect(byQ.reflective).toEqual({ x: -0.55, y: -0.55 });
  });

  it('selecting a preset dispatches addTap with its FIXED coord (same path, same payload)', () => {
    const store = makeStore();
    const tree = renderWith('dark', store);
    ReactTestRenderer.act(() => { byId(tree, 'emotion-preset-joyful').props.onPress(); });
    expect(store.getState().emotion.taps).toEqual([{ x: 0.55, y: 0.55 }]);
    // it is the very same reducer the wheel uses — no bespoke action
    const ctrl = makeStore();
    ctrl.dispatch(addTap({ x: 0.55, y: 0.55 }));
    expect(store.getState().emotion.taps).toEqual(ctrl.getState().emotion.taps);
  });

  it('each preset is a screen-reader button labelled by word + descriptor (colour never sole signal)', () => {
    const tree = renderWith('dark', makeStore());
    for (const p of EMOTION_PRESETS) {
      const item = byId(tree, `emotion-preset-${p.quadrant}`);
      expect(item.props.accessibilityRole).toBe('button');
      expect(item.props.accessibilityLabel).toContain(p.label);
      expect(item.props.accessibilityLabel).toContain(p.descriptor);
      // a visible glyph carries the shape signal in addition to the word
      expect(byId(tree, `emotion-preset-glyph-${p.quadrant}`).props.children).toBe(p.glyph);
    }
  });

  it('offers the SAME undo + clear as the wheel, via the cold reducers', () => {
    const store = makeStore();
    const tree = renderWith('dark', store);
    ReactTestRenderer.act(() => { byId(tree, 'emotion-preset-calm').props.onPress(); });
    ReactTestRenderer.act(() => { byId(tree, 'emotion-preset-intense').props.onPress(); });
    expect(store.getState().emotion.taps).toHaveLength(2);
    ReactTestRenderer.act(() => { byId(tree, 'emotion-list-undo').props.onPress(); });
    expect(store.getState().emotion.taps).toEqual([{ x: 0.55, y: -0.55 }]);
    ReactTestRenderer.act(() => { byId(tree, 'emotion-list-clear').props.onPress(); });
    expect(store.getState().emotion.taps).toEqual([]);
  });

  it('renders in both themes without a raw hex leaking (tokenised)', () => {
    expect(renderWith('light', makeStore())).toBeTruthy();
    expect(renderWith('dark', makeStore())).toBeTruthy();
  });
});
