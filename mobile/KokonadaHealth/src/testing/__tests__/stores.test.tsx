/// <reference types="node" />
import React from 'react';
import * as path from 'path';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Provider, useSelector } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import emotionReducer from '../../state/cold/emotionSlice';
import { createWarmStore } from '../../state/warm/warmStore';
import { SystemStateDock } from '../../navigation/SystemStateDock';
import { APP_ROOT, productionFiles } from '../guards/productionImports';
import { loadMutant } from '../mutant';
import {
  APP_STORE_SINGLETONS, STORE_FACTORIES, storeCallSites, trackAppStores, trackStore, unregisteredStores,
} from '../stores';

// QA-045 (stores half): every zustand store and the redux store expose a live subscribe count.
// GenerateScreen.test.tsx:660-692 hand-rolls this per screen with jest.spyOn on four stores; this is
// the shared form. The count wraps the store's REAL subscribe (capture-and-restore, no spyOn), so the
// store behaves exactly as in production while the count is kept.
// Pass rule: a planted unsubscribe removal fails.

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
const render = (el: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => { tree = ReactTestRenderer.create(el); });
  mounted.push(tree);
  return tree;
};
afterEach(() => { for (const t of mounted.splice(0)) { try { act(() => { t.unmount(); }); } catch { /* already unmounted */ } } });

describe('QA-045 · every store in production is in the registry', () => {
  const sites = storeCallSites(productionFiles());

  it('the scan finds the real stores (an empty input set must fail, not pass)', () => {
    expect(sites.filter((s) => s.kind === 'singleton').length).toBeGreaterThanOrEqual(11);
    expect(sites.map((s) => s.key)).toEqual(expect.arrayContaining(['src/state/store.ts#store', 'src/state/store.ts#warmStore']));
  });

  it('every module-level store is a registered singleton, and every store factory is listed', () => {
    expect(unregisteredStores(sites)).toEqual([]);
    expect(APP_STORE_SINGLETONS.map((s) => s.key).sort()).toEqual(sites.filter((s) => s.kind === 'singleton').map((s) => s.key).sort());
  });

  it('planted: a new module-level store, and a new factory, are both reported as unregistered', () => {
    const quote = String.fromCharCode(39);
    const planted = [
      'import { createStore } from ' + quote + 'zustand/vanilla' + quote + ';',
      'export function createPlantedStore() { return createStore(() => ({ n: 0 })); }',
      'export const plantedStore = createPlantedStore();',
    ].join('\n');
    const file = path.join(APP_ROOT, 'src/experience/planted/plantedStore.ts');
    expect(unregisteredStores(storeCallSites([file], () => planted))).toEqual([
      'factory src/experience/planted/plantedStore.ts#createPlantedStore',
      'singleton src/experience/planted/plantedStore.ts#plantedStore',
    ]);
  });

  it('each registered singleton loads as a store with subscribe()', () => {
    for (const s of APP_STORE_SINGLETONS) expect(typeof s.load().subscribe).toBe('function');
    expect(STORE_FACTORIES.length).toBeGreaterThan(0);
  });
});

describe('QA-045 · live subscribe counts (zustand)', () => {
  it('counts a real consumer: SystemStateDock subscribes on mount and unsubscribes on unmount', () => {
    const warm = createWarmStore();
    const t = trackStore(warm, 'warm');
    try {
      const tree = render(<SafeAreaProvider initialMetrics={METRICS}><SystemStateDock store={warm} /></SafeAreaProvider>);
      expect(t.live()).toBe(1);
      act(() => { tree.unmount(); });
      expect(t.live()).toBe(0);
      expect(t.total()).toBe(1);
    } finally {
      t.restore();
    }
  });

  it('planted: SystemStateDock with its unsubscribe removed (in memory) leaves a live subscription, and the check fails', () => {
    const { SystemStateDock: Mutant } = loadMutant<typeof import('../../navigation/SystemStateDock')>(
      path.join(APP_ROOT, 'src/navigation/SystemStateDock.tsx'),
      [{ find: 'return () => { mounted = false; off(); };', replace: 'return () => { mounted = false; };' }],
      require,
    );
    const warm = createWarmStore();
    const t = trackStore(warm, 'warm');
    try {
      const tree = render(<SafeAreaProvider initialMetrics={METRICS}><Mutant store={warm} /></SafeAreaProvider>);
      act(() => { tree.unmount(); });
      expect(t.live()).toBe(1);
      expect(() => t.assertNoLiveSubscriptions()).toThrow(/warm: 1 live subscription/);
    } finally {
      t.restore();
    }
  });

  it('the wrapped store still behaves as the real one (a set reaches the subscriber), and restore() is by identity', () => {
    const warm = createWarmStore();
    const real = warm.subscribe;
    const t = trackStore(warm, 'warm');
    const seen: string[] = [];
    const off = warm.subscribe((s) => seen.push(s.connection));
    warm.getState().setConnection('connected');
    off();
    off(); // idempotent, as zustand's own unsubscribe is
    expect(seen).toEqual(['connected']);
    expect(t.live()).toBe(0);
    t.restore();
    expect(warm.subscribe).toBe(real);
  });

  it('trackAppStores() counts every singleton, and a snapshot comparison names the store that leaked', () => {
    const app = trackAppStores();
    try {
      const before = app.snapshot();
      const leaked = APP_STORE_SINGLETONS.find((s) => s.name === 'playbackError')!.load();
      leaked.subscribe(() => {});
      expect(() => app.assertSameAs(before)).toThrow(/playbackError: 1 more live subscription/);
    } finally {
      app.restore();
    }
  });
});

describe('QA-045 · live subscribe counts (redux)', () => {
  function Probe() { const n = useSelector((s: { emotion: { taps: unknown[] } }) => s.emotion.taps.length); return <Text>{n}</Text>; }

  it('counts the Provider subscription a useSelector consumer opens, and its release on unmount', () => {
    const store = configureStore({ reducer: { emotion: emotionReducer } });
    const t = trackStore(store, 'redux');
    try {
      const tree = render(<Provider store={store}><Probe /></Provider>);
      expect(t.live()).toBeGreaterThan(0);
      act(() => { tree.unmount(); });
      expect(t.live()).toBe(0);
    } finally {
      t.restore();
    }
  });
});
