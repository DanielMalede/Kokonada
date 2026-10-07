// QA-103 (S10-1): teardown parity. Every subscription, listener, loop, timer and clock a page opens is
// closed on unmount.
//
// installTeardownProbes composes the shared fakes, the platform listeners (QA-044), every app store
// and any store the test adds (QA-045), a socket server (QA-045) and the motion fakes (QA-046), with
// a registry of live timers, and snapshots all of their live counts. A test snapshots before mount,
// unmounts, and assertParity() names every category whose count changed. The route manifest reads
// the routes from the real navigator source; a page registers its fixture in ROUTE_FIXTURES when it
// lands, and a route without one is reported (missingRouteFixtures).

import type React from 'react';
import ts from 'typescript';
import { Patcher } from './patch';
import { installPlatformFakes, PLATFORM_MODULES, type PlatformFakes, type PlatformInitial, type PlatformModule } from './platform';
import { installMotionFakes, type MotionFakes } from './motion';
import { trackAppStores, trackStore, type AppStoreTracker, type StoreTracker, type Subscribable } from './stores';
import { faceSource } from './faces';
import type { FakeSocketServer } from './socket';
import { parseSource, readSource } from './guards/sourceFiles';

export interface LiveCounts {
  platform: Record<PlatformModule, number>;
  stores: Record<string, number>;
  extraStores: Record<string, number>;
  socketListeners: number;
  frameCallbacks: number;
  clockSubscriptions: number;
  animations: number;
  nativeAnimations: number;
  loops: number;
  mappers: number;
  timers: number;
  faceSubscriptions: number;
}

export interface TeardownProbes {
  readonly platform: PlatformFakes;
  readonly motion: MotionFakes;
  readonly stores: AppStoreTracker;
  /** Track a store the test (or a factory) made, released by restore(). */
  trackStore(store: Subscribable, name: string): StoreTracker;
  snapshot(): LiveCounts;
  /** Throws, naming each category whose live count differs from `before`. */
  assertParity(before: LiveCounts): void;
  restore(): void;
}

/** A registry of live timers: a timeout until it fires or is cleared, an interval until it is cleared. */
function installTimerRegistry(patcher: Patcher) {
  const g = globalThis as unknown as Record<string, any>;
  const live = new Map<unknown, { kind: 'timeout' | 'interval'; site: string }>();
  const real = { setTimeout: g.setTimeout, clearTimeout: g.clearTimeout, setInterval: g.setInterval, clearInterval: g.clearInterval };
  const site = () => (new Error().stack ?? '').split('\n').slice(3, 7).map((l) => l.trim()).join(' <- ');
  const wrapped = {
    setTimeout(fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) {
      const id = real.setTimeout((...a: unknown[]) => { live.delete(id); fn(...a); }, ms, ...args);
      live.set(id, { kind: 'timeout', site: site() });
      return id;
    },
    clearTimeout(id: unknown) { live.delete(id); return real.clearTimeout(id); },
    setInterval(fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) {
      const id = real.setInterval(fn, ms, ...args);
      live.set(id, { kind: 'interval', site: site() });
      return id;
    },
    clearInterval(id: unknown) { live.delete(id); return real.clearInterval(id); },
  };
  for (const [k, v] of Object.entries(wrapped)) patcher.set(g, k, v);
  return {
    live(): number {
      if (g.setTimeout !== wrapped.setTimeout || g.setInterval !== wrapped.setInterval) {
        throw new Error('QA-103: the timer functions were replaced after the teardown probes were installed; call jest.useFakeTimers() before installTeardownProbes().');
      }
      return live.size;
    },
    sites: () => [...live.values()].map((t) => `${t.kind} added at ${t.site}`),
    /** Clear every timer still live (a test's leak must not outlive it or hold the process open). */
    clearAll() {
      for (const [id, t] of live) (t.kind === 'interval' ? real.clearInterval : real.clearTimeout)(id);
      live.clear();
    },
  };
}

export interface TeardownOptions { sockets?: FakeSocketServer; platform?: PlatformInitial }

export function installTeardownProbes(options: TeardownOptions = {}): TeardownProbes {
  const patcher = new Patcher();
  const timers = installTimerRegistry(patcher);
  const platform = installPlatformFakes(options.platform);
  const motion = installMotionFakes();
  const stores = trackAppStores();
  const extra: StoreTracker[] = [];

  const snapshot = (): LiveCounts => ({
    platform: Object.fromEntries(PLATFORM_MODULES.map((m) => [m, platform.live(m)])) as Record<PlatformModule, number>,
    stores: stores.snapshot(),
    extraStores: Object.fromEntries(extra.map((t) => [t.name, t.live()])),
    socketListeners: options.sockets?.liveListeners() ?? 0,
    frameCallbacks: motion.registeredFrameCallbacks(),
    clockSubscriptions: motion.clockSubscriptions(),
    animations: motion.activeAnimations(),
    nativeAnimations: motion.activeNativeAnimations(),
    loops: motion.activeLoops(),
    mappers: motion.mappers(),
    timers: timers.live(),
    faceSubscriptions: faceSource.listeners.size,
  });

  const LABELS: Array<[keyof LiveCounts, string]> = [
    ['socketListeners', 'socket listeners'],
    ['frameCallbacks', 'frame callbacks'],
    ['clockSubscriptions', 'Skia clock subscriptions'],
    ['animations', 'Reanimated animations'],
    ['nativeAnimations', 'RN Animated native-driver animations'],
    ['loops', 'RN Animated loops'],
    ['mappers', 'derived values / animated styles'],
    ['timers', 'timers'],
    ['faceSubscriptions', 'colour-scheme subscriptions'],
  ];
  const diff = (label: string, before: number, now: number) => {
    const d = now - before;
    return d === 0 ? null : `  ${label}: ${Math.abs(d)} ${d > 0 ? 'more' : 'fewer'} live than before mount`;
  };

  return {
    platform,
    motion,
    stores,
    trackStore(store, name) {
      const t = trackStore(store, name);
      extra.push(t);
      return t;
    },
    snapshot,
    assertParity(before) {
      const now = snapshot();
      const lines = [
        ...PLATFORM_MODULES.map((m) => diff(`platform.${m}`, before.platform[m], now.platform[m])),
        ...Object.keys({ ...before.stores, ...now.stores }).map((k) => diff(`store ${k}`, before.stores[k] ?? 0, now.stores[k] ?? 0)),
        ...Object.keys({ ...before.extraStores, ...now.extraStores }).map((k) => diff(`store ${k}`, before.extraStores[k] ?? 0, now.extraStores[k] ?? 0)),
        ...LABELS.map(([key, label]) => diff(label, before[key] as number, now[key] as number)),
      ].filter((l): l is string => l !== null);
      if (lines.length) {
        const timerSites = now.timers !== before.timers ? `\n  live timers:\n${timers.sites().map((x) => `    ${x}`).join('\n')}` : '';
        throw new Error(`QA-103: teardown parity broken (live after unmount vs before mount):\n${lines.join('\n')}${timerSites}`);
      }
    },
    restore() {
      for (const t of extra.splice(0).reverse()) t.restore();
      stores.restore();
      motion.restore();
      platform.restore();
      timers.clearAll();
      patcher.restore();
    },
  };
}

// ── The route manifest ──────────────────────────────────────────────────────────────────────────

/** A route's fixture: renders the page with everything it needs, for the parity and blur runs. */
export type RouteFixture = () => React.ReactElement | null;

/** Registered per page as pages land (P1–P11). Empty until then: v2 pages are not on main (D8 rule 3). */
export const ROUTE_FIXTURES: Record<string, RouteFixture> = {};

/** Every route a navigator registers: each `<X.Screen name="...">` in the given sources, in order. */
export function navigatorRoutes(files: string[], read: (file: string) => string = readSource): string[] {
  const out: string[] = [];
  for (const f of files) {
    if (!/\.[jt]sx$/.test(f)) continue;
    const visit = (n: ts.Node): void => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && ts.isPropertyAccessExpression(n.tagName) && n.tagName.name.text === 'Screen') {
        for (const attr of n.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name) || attr.name.text !== 'name' || !attr.initializer) continue;
          const init = attr.initializer;
          const value = ts.isStringLiteral(init) ? init.text
            : ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression) ? init.expression.text : null;
          if (value !== null && !out.includes(value)) out.push(value);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(parseSource(read(f), f));
  }
  return out;
}

export function missingRouteFixtures(routes: string[], fixtures: Record<string, RouteFixture> = ROUTE_FIXTURES): string[] {
  return routes.filter((r) => !(r in fixtures));
}
