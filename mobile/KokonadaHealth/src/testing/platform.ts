// QA-044: platform listener fakes with a live registry.
//
// The preset's AccessibilityInfo and AppState return {remove: jest.fn()} and keep nothing
// (@react-native/jest-preset/jest/mocks/AccessibilityInfo.js:12-14, AppState.js:11-17); jest's default
// platform is iOS, where BackHandler is a no-op (BackHandler.ios.js). So a listener that is never
// removed is invisible, and no test can deliver a mid-session change. These fakes replace the
// subscription members of the seven modules by capture-and-restore (patch.ts, never spyOn) and route
// every add through one registry: live counts per module and event, emit, and a leak check that
// names where each surviving listener was added.
//
// Semantics kept from RN 0.86: remove() is idempotent and removes only its own registration;
// Android's BackHandler walks handlers last-added-first and stops at the first that returns true,
// exiting the app when none does; useWindowDimensions reads Dimensions.get/addEventListener, so it
// follows set(); I18nManager has no listener API, and forceRTL/allowRTL take effect at the next start
// (isRTL = forced || (allowed && device RTL), I18nUtil.kt:22-24). Appearance.getColorScheme belongs to
// the face harness (faces.ts): emitting an Appearance change here also drives it when installed.

import * as RN from 'react-native';
import { Patcher } from './patch';
import { faceSource, type Face } from './faces';

export const PLATFORM_MODULES = ['AccessibilityInfo', 'AppState', 'Keyboard', 'BackHandler', 'Dimensions', 'Appearance', 'I18nManager'] as const;
export type PlatformModule = (typeof PLATFORM_MODULES)[number];

type Entry = { id: number; module: PlatformModule; event: string; handler: (...args: any[]) => unknown; site: string };

const A11Y_FLAGS = {
  reduceMotion: { event: 'reduceMotionChanged', query: 'isReduceMotionEnabled' },
  screenReader: { event: 'screenReaderChanged', query: 'isScreenReaderEnabled' },
  boldText: { event: 'boldTextChanged', query: 'isBoldTextEnabled' },
  grayscale: { event: 'grayscaleChanged', query: 'isGrayscaleEnabled' },
  invertColors: { event: 'invertColorsChanged', query: 'isInvertColorsEnabled' },
  reduceTransparency: { event: 'reduceTransparencyChanged', query: 'isReduceTransparencyEnabled' },
  highTextContrast: { event: 'highTextContrastChanged', query: 'isHighTextContrastEnabled' },
  darkerSystemColors: { event: 'darkerSystemColorsChanged', query: 'isDarkerSystemColorsEnabled' },
  accessibilityService: { event: 'accessibilityServiceChanged', query: 'isAccessibilityServiceEnabled' },
} as const;
export type A11yFlag = keyof typeof A11Y_FLAGS;
const A11Y_EVENTS = new Set<string>([...Object.values(A11Y_FLAGS).map((f) => f.event), 'announcementFinished', 'change']);
const APPSTATE_EVENTS = new Set(['change', 'memoryWarning', 'focus', 'blur']);
const KEYBOARD_EVENTS = new Set(['keyboardWillShow', 'keyboardDidShow', 'keyboardWillHide', 'keyboardDidHide', 'keyboardWillChangeFrame', 'keyboardDidChangeFrame']);

export type AppStateStatus = 'active' | 'background' | 'inactive';
export interface WindowSize { width: number; height: number; scale?: number; fontScale?: number }

export interface PlatformInitial {
  accessibility?: Partial<Record<A11yFlag, boolean>>;
  appState?: AppStateStatus;
  window?: WindowSize;
  rtl?: { isRTL?: boolean; deviceRTL?: boolean; localeIdentifier?: string };
}

export interface PlatformFakes {
  /** Live listeners: all, one module, or one module's event. */
  live(module?: PlatformModule, event?: string): number;
  liveByModule(): Record<PlatformModule, number>;
  /** Throws, naming each live listener and where it was added, unless none is live. */
  assertNoLiveListeners(): void;
  /** Deliver an event to the live listeners of a module (raw: no state change). */
  emit(module: PlatformModule, event: string, ...args: unknown[]): void;
  accessibility: { set(flag: A11yFlag, value: boolean): void; get(flag: A11yFlag): boolean; announcements(): string[] };
  appState: { set(status: AppStateStatus): void; get(): AppStateStatus };
  keyboard: { show(height: number, width?: number): void; hide(): void };
  backHandler: { press(): boolean; exits(): number };
  dimensions: { set(window: WindowSize, screen?: WindowSize): void };
  appearance: { set(scheme: Face): void };
  i18n: { setDeviceRTL(rtl: boolean): void; restart(): void };
  restore(): void;
}

let installed = false;

export function installPlatformFakes(initial: PlatformInitial = {}): PlatformFakes {
  if (installed) throw new Error('QA-044: platform fakes are already installed; restore() the previous install first.');
  installed = true;
  const patcher = new Patcher();
  const registry = new Map<number, Entry>();
  let nextId = 1;

  const add = (module: PlatformModule, event: string, handler: (...args: any[]) => unknown) => {
    const id = nextId++;
    const site = (new Error().stack ?? '').split('\n').slice(3, 6).map((l) => l.trim()).join(' <- ');
    registry.set(id, { id, module, event, handler, site });
    return { remove: () => { registry.delete(id); } };
  };
  const listeners = (module: PlatformModule, event: string) =>
    [...registry.values()].filter((e) => e.module === module && e.event === event);
  const emit = (module: PlatformModule, event: string, ...args: unknown[]) => {
    for (const e of listeners(module, event)) e.handler(...args);
  };

  // ── AccessibilityInfo ───────────────────────────────────────────────────────────────────────────
  const a11y: Record<A11yFlag, boolean> = Object.fromEntries(Object.keys(A11Y_FLAGS).map((k) => [k, false])) as Record<A11yFlag, boolean>;
  Object.assign(a11y, initial.accessibility ?? {});
  const announcements: string[] = [];
  const A = RN.AccessibilityInfo as unknown as Record<string, unknown>;
  patcher.set(A, 'addEventListener', (event: string, handler: (...args: any[]) => unknown) => {
    // RN returns a no-op subscription for an event name it does not know (AccessibilityInfo.js).
    if (!A11Y_EVENTS.has(event)) return { remove() {} };
    return add('AccessibilityInfo', event, handler);
  });
  for (const [flag, { query }] of Object.entries(A11Y_FLAGS)) {
    patcher.set(A, query, () => Promise.resolve(a11y[flag as A11yFlag]));
  }
  patcher.set(A, 'announceForAccessibility', (msg: string) => { announcements.push(msg); });
  patcher.set(A, 'announceForAccessibilityWithOptions', (msg: string) => { announcements.push(msg); });

  // ── AppState ─────────────────────────────────────────────────────────────────────────────────────
  let appState: AppStateStatus = initial.appState ?? 'active';
  const S = RN.AppState as unknown as Record<string, unknown>;
  patcher.set(S, 'addEventListener', (event: string, handler: (...args: any[]) => unknown) => {
    if (!APPSTATE_EVENTS.has(event)) throw new Error(`Trying to subscribe to unknown event: "${event}"`);
    return add('AppState', event, handler);
  });
  patcher.define(S, 'currentState', { get: () => appState });
  // RN 0.86's AppState has no removeEventListener (the preset's mock still carries one).
  patcher.set(S, 'removeEventListener', undefined);

  // ── Keyboard ─────────────────────────────────────────────────────────────────────────────────────
  let keyboardShown: { height: number; width: number } | null = null;
  const K = RN.Keyboard as unknown as Record<string, unknown>;
  patcher.set(K, 'addListener', (event: string, handler: (...args: any[]) => unknown) => {
    if (!KEYBOARD_EVENTS.has(event)) return { remove() {} };
    return add('Keyboard', event, handler);
  });
  patcher.set(K, 'removeAllListeners', (event?: string) => {
    for (const e of [...registry.values()]) if (e.module === 'Keyboard' && (event == null || e.event === event)) registry.delete(e.id);
  });
  patcher.set(K, 'isVisible', () => keyboardShown !== null);
  patcher.set(K, 'metrics', () => (keyboardShown ? { screenX: 0, screenY: 0, width: keyboardShown.width, height: keyboardShown.height } : undefined));
  const hideKeyboard = () => {
    if (!keyboardShown) return;
    keyboardShown = null;
    const ev = { duration: 0, easing: 'keyboard', endCoordinates: { screenX: 0, screenY: 0, width: 0, height: 0 } };
    emit('Keyboard', 'keyboardDidHide', ev);
  };
  patcher.set(K, 'dismiss', hideKeyboard);

  // ── BackHandler (Android semantics) ──────────────────────────────────────────────────────────────
  let exits = 0;
  const B = RN.BackHandler as unknown as Record<string, unknown>;
  patcher.set(B, 'addEventListener', (event: string, handler: (...args: any[]) => unknown) => add('BackHandler', event, handler));
  patcher.set(B, 'exitApp', () => { exits += 1; });

  // ── Dimensions / useWindowDimensions ────────────────────────────────────────────────────────────
  const real = RN.Dimensions.get('window');
  const sized = (w: WindowSize) => ({ width: w.width, height: w.height, scale: w.scale ?? real.scale, fontScale: w.fontScale ?? real.fontScale });
  let dims = { window: sized(initial.window ?? real), screen: sized(initial.window ?? RN.Dimensions.get('screen')) };
  const D = RN.Dimensions as unknown as Record<string, unknown>;
  patcher.set(D, 'get', (dim: string) => {
    const v = (dims as Record<string, unknown>)[dim];
    if (!v) throw new Error('No dimension set for key ' + dim);
    return v;
  });
  patcher.set(D, 'addEventListener', (event: string, handler: (...args: any[]) => unknown) => {
    if (event !== 'change') throw new Error(`Trying to subscribe to unknown event: "${event}"`);
    return add('Dimensions', event, handler);
  });

  // ── Appearance ───────────────────────────────────────────────────────────────────────────────────
  const P = RN.Appearance as unknown as Record<string, unknown>;
  patcher.set(P, 'addChangeListener', (handler: (...args: any[]) => unknown) => add('Appearance', 'change', handler));

  // ── I18nManager (state only: RN 0.86 exposes no listener) ───────────────────────────────────────
  const I = RN.I18nManager as unknown as Record<string, unknown>;
  const constants = (RN.I18nManager.getConstants?.() ?? {}) as { localeIdentifier?: string };
  const rtl = {
    isRTL: initial.rtl?.isRTL ?? false,
    deviceRTL: initial.rtl?.deviceRTL ?? false,
    allowed: true,
    forced: false,
    swap: true,
    localeIdentifier: initial.rtl?.localeIdentifier ?? constants.localeIdentifier ?? 'en_US',
  };
  const publishRTL = () => {
    patcher.set(I, 'isRTL', rtl.isRTL);
    patcher.set(I, 'doLeftAndRightSwapInRTL', rtl.swap);
  };
  publishRTL();
  patcher.set(I, 'getConstants', () => ({ isRTL: rtl.isRTL, doLeftAndRightSwapInRTL: rtl.swap, localeIdentifier: rtl.localeIdentifier }));
  patcher.set(I, 'forceRTL', (v: boolean) => { rtl.forced = v; });
  patcher.set(I, 'allowRTL', (v: boolean) => { rtl.allowed = v; });
  patcher.set(I, 'swapLeftAndRightInRTL', (v: boolean) => { rtl.swap = v; });

  const live = (module?: PlatformModule, event?: string) =>
    [...registry.values()].filter((e) => (module == null || e.module === module) && (event == null || e.event === event)).length;

  return {
    live,
    liveByModule: () => Object.fromEntries(PLATFORM_MODULES.map((m) => [m, live(m)])) as Record<PlatformModule, number>,
    assertNoLiveListeners() {
      if (registry.size === 0) return;
      const lines = [...registry.values()].map((e) => `  ${e.module}.${e.event} added at ${e.site}`);
      throw new Error(`QA-044: ${registry.size} platform listener(s) still live:\n${lines.join('\n')}`);
    },
    emit,
    accessibility: {
      set(flag, value) {
        a11y[flag] = value;
        emit('AccessibilityInfo', A11Y_FLAGS[flag].event, value);
        if (flag === 'screenReader') emit('AccessibilityInfo', 'change', value); // the legacy alias
      },
      get: (flag) => a11y[flag],
      announcements: () => [...announcements],
    },
    appState: {
      set(status) {
        if (status === appState) return;
        appState = status;
        emit('AppState', 'change', status);
      },
      get: () => appState,
    },
    keyboard: {
      show(height, width = dims.window.width) {
        keyboardShown = { height, width };
        const ev = { duration: 0, easing: 'keyboard', endCoordinates: { screenX: 0, screenY: dims.window.height - height, width, height } };
        emit('Keyboard', 'keyboardDidShow', ev);
      },
      hide: hideKeyboard,
    },
    backHandler: {
      press() {
        const handlers = listeners('BackHandler', 'hardwareBackPress').reverse();
        for (const e of handlers) if (e.handler() === true) return true;
        exits += 1;
        return false;
      },
      exits: () => exits,
    },
    dimensions: {
      set(window, screen) {
        dims = { window: sized(window), screen: sized(screen ?? window) };
        emit('Dimensions', 'change', { window: dims.window, screen: dims.screen });
      },
    },
    appearance: {
      set(scheme) {
        if (faceSource.installed) faceSource.set(scheme);
        emit('Appearance', 'change', { colorScheme: scheme });
      },
    },
    i18n: {
      setDeviceRTL(v) { rtl.deviceRTL = v; },
      restart() {
        rtl.isRTL = rtl.forced || (rtl.allowed && rtl.deviceRTL);
        publishRTL();
      },
    },
    restore() {
      patcher.restore();
      registry.clear();
      installed = false;
    },
  };
}

/** Install the platform fakes around every test of the enclosing describe (or file). */
export function usePlatformFakes(initial?: PlatformInitial): () => PlatformFakes {
  let current: PlatformFakes | null = null;
  beforeEach(() => { current = installPlatformFakes(initial); });
  afterEach(() => { current?.restore(); current = null; });
  return () => {
    if (!current) throw new Error('QA-044: the platform fakes are installed only inside a test.');
    return current;
  };
}
