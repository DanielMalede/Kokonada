import React, { useEffect, useState } from 'react';
import * as RN from 'react-native';
import { Text, useWindowDimensions } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useMotion, useTheme } from '../../design/theme';
import { installPlatformFakes, PLATFORM_MODULES, type PlatformFakes, type PlatformModule } from '../platform';
import { createFaceGuard } from '../faces';

// QA-044: AccessibilityInfo, AppState, Keyboard, BackHandler, Dimensions/useWindowDimensions,
// Appearance and I18nManager get fakes with add/remove/emit and a live listener count. The preset
// returns {remove: jest.fn()} and keeps no registry (jest-preset/jest/mocks/AccessibilityInfo.js:12-14),
// so a listener added and never removed is invisible, and no test can emit a mid-session change.
// Pass rule: a planted add-without-remove fails; a planted mid-session emit changes rendered state.

let fakes: PlatformFakes;
beforeEach(() => { fakes = installPlatformFakes(); });
afterEach(() => { fakes.restore(); });

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
const render = (el: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => { tree = ReactTestRenderer.create(el); });
  mounted.push(tree);
  return tree;
};
const unmount = (tree: ReactTestRenderer.ReactTestRenderer) => act(() => { tree.unmount(); });
afterEach(() => { for (const t of mounted.splice(0)) { try { act(() => { t.unmount(); }); } catch { /* already unmounted */ } } });
const textOf = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findByType(Text).props.children;
const flush = () => act(async () => { await Promise.resolve(); });

// One subscribe call per module, exactly as app code writes it. Each returns its remover.
const SUBSCRIBE: Record<Exclude<PlatformModule, 'I18nManager'>, () => { remove(): void }> = {
  AccessibilityInfo: () => RN.AccessibilityInfo.addEventListener('reduceMotionChanged', () => {}),
  AppState: () => RN.AppState.addEventListener('change', () => {}),
  Keyboard: () => RN.Keyboard.addListener('keyboardDidShow', () => {}),
  BackHandler: () => RN.BackHandler.addEventListener('hardwareBackPress', () => true),
  Dimensions: () => RN.Dimensions.addEventListener('change', () => {}),
  Appearance: () => RN.Appearance.addChangeListener(() => {}),
};

describe('QA-044 · every platform module keeps a live listener registry', () => {
  it('covers the seven modules the rule names', () => {
    expect([...PLATFORM_MODULES].sort()).toEqual(['AccessibilityInfo', 'AppState', 'Appearance', 'BackHandler', 'Dimensions', 'I18nManager', 'Keyboard']);
  });

  describe.each(Object.keys(SUBSCRIBE) as Array<keyof typeof SUBSCRIBE>)('%s', (module) => {
    // The planted defect: a listener added in an effect that never returns its cleanup.
    function Leaker() { useEffect(() => { SUBSCRIBE[module](); }, []); return null; }
    function Clean() { useEffect(() => { const sub = SUBSCRIBE[module](); return () => sub.remove(); }, []); return null; }

    it('a planted add-without-remove is still live after unmount, and the leak check fails', () => {
      const tree = render(<Leaker />);
      expect(fakes.live(module)).toBe(1);
      unmount(tree);
      expect(fakes.live(module)).toBe(1);
      expect(() => fakes.assertNoLiveListeners()).toThrow(new RegExp(`${module}`));
    });

    it('a component that removes its listener leaves 0 live, and the leak check passes', () => {
      const tree = render(<Clean />);
      expect(fakes.live(module)).toBe(1);
      unmount(tree);
      expect(fakes.live(module)).toBe(0);
      expect(() => fakes.assertNoLiveListeners()).not.toThrow();
    });

    it('remove() is idempotent and removes only its own registration', () => {
      const a = SUBSCRIBE[module]();
      const b = SUBSCRIBE[module]();
      expect(fakes.live(module)).toBe(2);
      a.remove();
      a.remove();
      expect(fakes.live(module)).toBe(1);
      b.remove();
      expect(fakes.live()).toBe(0);
    });
  });

  it('restore() puts every replaced member back by identity', () => {
    const members = () => ({
      a11yAdd: RN.AccessibilityInfo.addEventListener,
      a11yReduce: RN.AccessibilityInfo.isReduceMotionEnabled,
      appStateAdd: RN.AppState.addEventListener,
      keyboardAdd: RN.Keyboard.addListener,
      backAdd: RN.BackHandler.addEventListener,
      dimsAdd: RN.Dimensions.addEventListener,
      dimsGet: RN.Dimensions.get,
      appearanceAdd: RN.Appearance.addChangeListener,
      forceRTL: RN.I18nManager.forceRTL,
    });
    fakes.restore();
    const pristine = members();
    const again = installPlatformFakes();
    const faked = members();
    for (const key of Object.keys(pristine) as Array<keyof typeof pristine>) expect(faked[key]).not.toBe(pristine[key]);
    again.restore();
    expect(members()).toEqual(pristine);
    expect(jest.isMockFunction(RN.AccessibilityInfo.addEventListener)).toBe(true); // the preset's own mock is back
    fakes = installPlatformFakes(); // for the afterEach
  });
});

describe('QA-044 · a mid-session emit changes rendered state (real consumers)', () => {
  it('AccessibilityInfo: the real useMotion() follows reduce-motion turned on mid-session', async () => {
    function Probe() { return <Text>{useMotion().reduced ? 'reduced' : 'full'}</Text>; }
    const tree = render(<Probe />);
    await flush();
    expect(textOf(tree)).toBe('full');
    act(() => { fakes.accessibility.set('reduceMotion', true); });
    expect(textOf(tree)).toBe('reduced');
    expect(fakes.live('AccessibilityInfo')).toBe(1);
    unmount(tree);
    expect(fakes.live('AccessibilityInfo')).toBe(0); // useMotion cleans up
  });

  it('AccessibilityInfo: the initial query answers the scripted state', async () => {
    fakes.accessibility.set('reduceMotion', true);
    function Probe() { return <Text>{useMotion().reduced ? 'reduced' : 'full'}</Text>; }
    const tree = render(<Probe />);
    await flush();
    expect(textOf(tree)).toBe('reduced');
    await expect(RN.AccessibilityInfo.isScreenReaderEnabled()).resolves.toBe(false);
  });

  it('AppState: a background → active transition reaches a subscriber and currentState', () => {
    function Probe() {
      const [s, setS] = useState(RN.AppState.currentState);
      useEffect(() => { const sub = RN.AppState.addEventListener('change', setS); return () => sub.remove(); }, []);
      return <Text>{String(s)}</Text>;
    }
    const tree = render(<Probe />);
    expect(textOf(tree)).toBe('active');
    act(() => { fakes.appState.set('background'); });
    expect(textOf(tree)).toBe('background');
    expect(RN.AppState.currentState).toBe('background');
  });

  it('Keyboard: show and hide reach a subscriber; isVisible() and metrics() follow', () => {
    function Probe() {
      const [h, setH] = useState(0);
      useEffect(() => {
        const a = RN.Keyboard.addListener('keyboardDidShow', (e) => setH(e.endCoordinates.height));
        const b = RN.Keyboard.addListener('keyboardDidHide', () => setH(0));
        return () => { a.remove(); b.remove(); };
      }, []);
      return <Text>{h}</Text>;
    }
    const tree = render(<Probe />);
    act(() => { fakes.keyboard.show(320); });
    expect(textOf(tree)).toBe(320);
    expect(RN.Keyboard.isVisible()).toBe(true);
    expect(RN.Keyboard.metrics()?.height).toBe(320);
    act(() => { fakes.keyboard.hide(); });
    expect(textOf(tree)).toBe(0);
    expect(RN.Keyboard.isVisible()).toBe(false);
  });

  it('BackHandler: Android order (last added first, first true stops), unhandled exits the app', () => {
    const calls: string[] = [];
    const a = RN.BackHandler.addEventListener('hardwareBackPress', () => { calls.push('a'); return false; });
    const b = RN.BackHandler.addEventListener('hardwareBackPress', () => { calls.push('b'); return true; });
    expect(fakes.backHandler.press()).toBe(true);
    expect(calls).toEqual(['b']);
    b.remove();
    expect(fakes.backHandler.press()).toBe(false);
    expect(calls).toEqual(['b', 'a']);
    expect(fakes.backHandler.exits()).toBe(1);
    a.remove();
  });

  it('Dimensions: the real useWindowDimensions() follows a rotation', () => {
    fakes.dimensions.set({ width: 390, height: 844 });
    function Probe() { const { width } = useWindowDimensions(); return <Text>{width}</Text>; }
    const tree = render(<Probe />);
    expect(textOf(tree)).toBe(390);
    act(() => { fakes.dimensions.set({ width: 844, height: 390 }); });
    expect(textOf(tree)).toBe(844);
    unmount(tree);
    expect(fakes.live('Dimensions')).toBe(0);
  });

  it('Appearance: a system dark-mode switch reaches a direct listener', () => {
    function Probe() {
      const [s, setS] = useState<string>('unset');
      useEffect(() => { const sub = RN.Appearance.addChangeListener(({ colorScheme }) => setS(String(colorScheme))); return () => sub.remove(); }, []);
      return <Text>{s}</Text>;
    }
    const tree = render(<Probe />);
    act(() => { fakes.appearance.set('dark'); });
    expect(textOf(tree)).toBe('dark');
  });

  it('Appearance with the face guard: the same switch re-renders the real useTheme() consumer', () => {
    const faces = createFaceGuard();
    faces.install();
    try {
      faces.set('light');
      function Probe() { return <Text>{useTheme().name}</Text>; }
      const tree = render(<Probe />);
      expect(textOf(tree)).toBe('light');
      act(() => { fakes.appearance.set('dark'); });
      expect(textOf(tree)).toBe('dark');
      unmount(tree);
    } finally {
      faces.restore();
    }
  });

  it('I18nManager: forceRTL applies at the next start, never mid-session (no listener API in RN 0.86)', () => {
    expect(RN.I18nManager.isRTL).toBe(false);
    RN.I18nManager.forceRTL(true);
    expect(RN.I18nManager.isRTL).toBe(false); // the running process keeps its direction
    fakes.i18n.restart();
    expect(RN.I18nManager.isRTL).toBe(true);
    expect(RN.I18nManager.getConstants().isRTL).toBe(true);
    expect(fakes.live('I18nManager')).toBe(0);
  });

  it('I18nManager: a device in an RTL locale is RTL only while allowRTL holds (I18nUtil.kt:22-24)', () => {
    fakes.i18n.setDeviceRTL(true);
    fakes.i18n.restart();
    expect(RN.I18nManager.isRTL).toBe(true);
    RN.I18nManager.allowRTL(false);
    fakes.i18n.restart();
    expect(RN.I18nManager.isRTL).toBe(false);
  });
});
