import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { StyleSheet } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, { setActivity } from '../../../state/cold/emotionSlice';
import { ActivityChips } from '../ActivityChips';
import { ACTIVITIES } from '../activities';
import { colors, space, type ThemeName } from '../../../design/tokens';
import { auroraGlow } from '../../../design/emotionAccent';
import { CTA_INK } from '../../../design/auroraSurfaces';
import { contrastRatio, parseHex, AA_NORMAL } from '../../../design/contrast';

const makeStore = () => configureStore({ reducer: { emotion: emotionReducer } });

function renderWith(scheme: ThemeName, store: ReturnType<typeof makeStore>) {
  jest.spyOn(RN, 'useColorScheme').mockReturnValue(scheme);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<Provider store={store}><ActivityChips /></Provider>);
  });
  return tree;
}
const chip = (tree: ReactTestRenderer.ReactTestRenderer, key: string) =>
  tree.root.findAll((n) => n.props?.testID === `activity-chip-${key}`)[0];
const flat = (n: any) => StyleSheet.flatten(n.props.style) as any;
afterEach(() => jest.restoreAllMocks());

describe('ActivityChips — tokenised, single-select, ≥44dp', () => {
  it('renders one chip per preset in BOTH themes (no crash, tokenised)', () => {
    const dark = renderWith('dark', makeStore());
    for (const a of ACTIVITIES) expect(chip(dark, a.key)).toBeTruthy();
    const light = renderWith('light', makeStore());
    for (const a of ACTIVITIES) expect(chip(light, a.key)).toBeTruthy();
  });

  it('every chip target is at least a 44dp (space.3xl = 48) minHeight', () => {
    const tree = renderWith('dark', makeStore());
    for (const a of ACTIVITIES) expect(flat(chip(tree, a.key)).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('selecting a chip commits its key; re-tapping the active chip clears it (toggle → null)', () => {
    const store = makeStore();
    const tree = renderWith('dark', store);
    ReactTestRenderer.act(() => { chip(tree, 'running').props.onPress(); });
    expect(store.getState().emotion.activity).toBe('running');
    // re-render reflects the selection, then re-tap clears
    const tree2 = renderWith('dark', store);
    ReactTestRenderer.act(() => { chip(tree2, 'running').props.onPress(); });
    expect(store.getState().emotion.activity).toBeNull();
  });

  it('the active chip is distinguished beyond colour (accessibilityState.selected + accent border)', () => {
    const store = makeStore();
    store.dispatch(setActivity('focus'));
    const tree = renderWith('dark', store);
    const active = chip(tree, 'focus');
    expect(active.props.accessibilityState.selected).toBe(true);
    expect(flat(active).borderColor).toBe(colors.dark.accent.glow); // accent outline on active
    const idle = chip(tree, 'running');
    expect(idle.props.accessibilityState.selected).toBe(false);
    expect(flat(idle).borderColor).toBe(colors.dark.surface.hairline); // quiet hairline when idle
  });

  it('uses no raw hex — the idle chip is the token frosted glass (its opaque AA fallback)', () => {
    const tree = renderWith('light', makeStore());
    expect(flat(chip(tree, 'running')).backgroundColor).toBe(colors.light.surface.glassFallback);
    expect(space['3xl']).toBe(48);
  });

  it('AURORA legibility: the idle muted label + the selected ink both clear AA-normal over their fills', () => {
    const mix2 = (a: string, b: string, t: number) => {
      const A = parseHex(a); const B = parseHex(b);
      const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
      return `#${h(A.r + (B.r - A.r) * t)}${h(A.g + (B.g - A.g) * t)}${h(A.b + (B.b - A.b) * t)}`;
    };
    for (const t of [colors.dark, colors.light]) {
      // idle label: content.muted over the opaque glass the chip degrades to (small text → AA-normal)
      expect(contrastRatio(t.content.muted, t.surface.glassFallback)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
    // selected ink: the deep indigo across the WHOLE neutral-aurora → gold gradient (theme-independent fill)
    for (let k = 0; k <= 1.0001; k += 0.1) {
      expect(contrastRatio(CTA_INK.dark, mix2(auroraGlow(0, 0), colors.dark.accent.gold, k))).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});
