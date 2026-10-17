/// <reference types="node" />
// QA-045 (stores): live subscribe counts for every zustand store and the redux store.
//
// trackStore wraps a store's REAL subscribe by capture-and-restore (patch.ts): each call is counted
// live until its unsubscribe runs (idempotently, as zustand's and redux's own are), and the store
// keeps its exact behaviour. APP_STORE_SINGLETONS is every module-level store in production, and a
// static scan (storeCallSites) keeps it complete: a new store module that is not registered fails
// stores.test.tsx. Stores a factory makes at run time are tracked by the test that makes them.

import * as path from 'path';
import ts from 'typescript';
import { Patcher } from './patch';
import { APP_ROOT } from './guards/productionImports';
import { parseSource, readSource } from './guards/sourceFiles';

export interface Subscribable { subscribe(listener: (...args: any[]) => void): () => void }

export interface StoreTracker {
  readonly name: string;
  live(): number;
  total(): number;
  assertNoLiveSubscriptions(): void;
  restore(): void;
}

const tracked = new WeakSet<object>();

export function trackStore(store: Subscribable, name: string): StoreTracker {
  if (tracked.has(store)) throw new Error(`QA-045: the store "${name}" is already tracked; restore() the first tracker.`);
  tracked.add(store);
  const patcher = new Patcher();
  const real = store.subscribe;
  let live = 0;
  let total = 0;
  patcher.set(store, 'subscribe', (listener: (...args: any[]) => void) => {
    const unsubscribe = real.call(store, listener);
    let active = true;
    live += 1;
    total += 1;
    return () => {
      if (active) { active = false; live -= 1; }
      return unsubscribe();
    };
  });
  return {
    name,
    live: () => live,
    total: () => total,
    assertNoLiveSubscriptions() {
      if (live !== 0) throw new Error(`QA-045: ${name}: ${live} live subscription(s) after teardown.`);
    },
    restore() {
      patcher.restore();
      tracked.delete(store);
    },
  };
}

export interface RegisteredStore { key: string; name: string; kind: 'zustand' | 'redux'; load(): Subscribable }

// Every module-level store in production. Keyed `src/<file>#<export>`; storeCallSites keeps it complete.
export const APP_STORE_SINGLETONS: RegisteredStore[] = [
  { key: 'src/auth/currentUser.ts#currentUserStore', name: 'currentUser', kind: 'zustand', load: () => require('../auth/currentUser').currentUserStore },
  { key: 'src/experience/connect/connectStore.ts#connectStore', name: 'connect', kind: 'zustand', load: () => require('../experience/connect/connectStore').connectStore },
  { key: 'src/experience/generate/generationStatusStore.ts#generationStatusStore', name: 'generationStatus', kind: 'zustand', load: () => require('../experience/generate/generationStatusStore').generationStatusStore },
  { key: 'src/experience/generate/liveModeStore.ts#liveModeStore', name: 'liveMode', kind: 'zustand', load: () => require('../experience/generate/liveModeStore').liveModeStore },
  { key: 'src/experience/playback/nowPlayingStore.ts#nowPlayingStore', name: 'nowPlaying', kind: 'zustand', load: () => require('../experience/playback/nowPlayingStore').nowPlayingStore },
  { key: 'src/experience/playback/playbackErrorStore.ts#playbackErrorStore', name: 'playbackError', kind: 'zustand', load: () => require('../experience/playback/playbackErrorStore').playbackErrorStore },
  { key: 'src/experience/player/playerStatusStore.ts#playerStatusStore', name: 'playerStatus', kind: 'zustand', load: () => require('../experience/player/playerStatusStore').playerStatusStore },
  { key: 'src/experience/pulse/pulseStateStore.ts#pulseStateStore', name: 'pulseState', kind: 'zustand', load: () => require('../experience/pulse/pulseStateStore').pulseStateStore },
  { key: 'src/onboarding/onboardingStore.ts#onboardingStore', name: 'onboarding', kind: 'zustand', load: () => require('../onboarding/onboardingStore').onboardingStore },
  { key: 'src/state/store.ts#store', name: 'redux', kind: 'redux', load: () => require('../state/store').store },
  { key: 'src/state/store.ts#warmStore', name: 'warm', kind: 'zustand', load: () => require('../state/store').warmStore },
];

// The functions that make stores. A test that calls one tracks the instance with trackStore().
export const STORE_FACTORIES: string[] = [
  'src/auth/currentUser.ts#createCurrentUserStore',
  'src/experience/connect/connectStore.ts#createConnectStore',
  'src/experience/generate/generationStatusStore.ts#createGenerationStatusStore',
  'src/experience/generate/liveModeStore.ts#createLiveModeStore',
  'src/experience/playback/nowPlayingStore.ts#createNowPlayingStore',
  'src/experience/player/playerStatusStore.ts#createPlayerStatusStore',
  'src/experience/pulse/pulseStateStore.ts#createPulseStateStore',
  'src/health/consentStore.ts#createConsentFlow',
  'src/onboarding/onboardingStore.ts#createOnboardingStore',
  'src/state/warm/warmStore.ts#createWarmStore',
];

const STORE_APIS: Record<string, string[]> = {
  'zustand': ['create', 'createStore'],
  'zustand/vanilla': ['createStore'],
  '@reduxjs/toolkit': ['configureStore', 'createStore'],
  'redux': ['createStore', 'legacy_createStore'],
};

export interface StoreSite { kind: 'singleton' | 'factory'; key: string }

const relKey = (file: string, name: string) => `${path.relative(APP_ROOT, file).split(path.sep).join('/')}#${name}`;

function storeApiNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of file.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const apis = STORE_APIS[st.moduleSpecifier.text];
    const named = st.importClause?.namedBindings;
    if (!apis || !named || !ts.isNamedImports(named)) continue;
    for (const el of named.elements) if (apis.includes((el.propertyName ?? el.name).text)) names.add(el.name.text);
  }
  return names;
}

const calleeName = (call: ts.CallExpression): string | null => (ts.isIdentifier(call.expression) ? call.expression.text : null);

function enclosingFunctionName(node: ts.Node): string | null | undefined {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) || ts.isMethodDeclaration(p)) {
      if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isMethodDeclaration(p)) && p.name && ts.isIdentifier(p.name)) return p.name.text;
      if (p.parent && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) return p.parent.name.text;
      return null; // an anonymous function: a factory without a name
    }
  }
  return undefined; // module scope
}

/** Every store a production module makes: module-level singletons and the factories that make stores. */
export function storeCallSites(files: string[], read: (file: string) => string = readSource): StoreSite[] {
  const parsed = files.map((f) => ({ f, sf: parseSource(read(f), f) }));
  const factories = new Map<string, string>(); // factory name -> key
  for (const { f, sf } of parsed) {
    const apis = storeApiNames(sf);
    if (apis.size === 0) continue;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && apis.has(calleeName(n) ?? '')) {
        const owner = enclosingFunctionName(n);
        // a call at module scope is a singleton, found below through its declaration
        if (owner !== undefined) factories.set(owner ?? '<anonymous>', relKey(f, owner ?? '<anonymous>'));
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const sites: StoreSite[] = [...factories.values()].map((key) => ({ kind: 'factory' as const, key }));
  for (const { f, sf } of parsed) {
    const apis = storeApiNames(sf);
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer || !ts.isCallExpression(d.initializer)) continue;
        const callee = calleeName(d.initializer);
        if (callee && (apis.has(callee) || factories.has(callee))) sites.push({ kind: 'singleton', key: relKey(f, d.name.text) });
      }
    }
  }
  return sites.sort((a, b) => (a.kind + a.key).localeCompare(b.kind + b.key));
}

/** The sites missing from APP_STORE_SINGLETONS or STORE_FACTORIES, as `kind key`. */
export function unregisteredStores(sites: StoreSite[]): string[] {
  const singletons = new Set(APP_STORE_SINGLETONS.map((s) => s.key));
  const factories = new Set(STORE_FACTORIES);
  return sites
    .filter((s) => (s.kind === 'singleton' ? !singletons.has(s.key) : !factories.has(s.key)))
    .map((s) => `${s.kind} ${s.key}`)
    .sort();
}

export interface AppStoreTracker {
  live(name?: string): number;
  snapshot(): Record<string, number>;
  /** Throws, naming each store whose live count differs from the snapshot. */
  assertSameAs(snapshot: Record<string, number>): void;
  restore(): void;
}

/** Track every registered singleton at once (for teardown parity). */
export function trackAppStores(): AppStoreTracker {
  const trackers = APP_STORE_SINGLETONS.map((s) => trackStore(s.load(), s.name));
  const snapshot = () => Object.fromEntries(trackers.map((t) => [t.name, t.live()]));
  return {
    live: (name) => trackers.filter((t) => name == null || t.name === name).reduce((n, t) => n + t.live(), 0),
    snapshot,
    assertSameAs(before) {
      const now = snapshot();
      const diffs = Object.keys(now)
        .filter((k) => now[k] !== (before[k] ?? 0))
        .map((k) => {
          const d = now[k] - (before[k] ?? 0);
          return `  ${k}: ${Math.abs(d)} ${d > 0 ? 'more' : 'fewer'} live subscription(s) than before`;
        });
      if (diffs.length) throw new Error(`QA-045: store subscriptions changed across the teardown:\n${diffs.join('\n')}`);
    },
    restore() { for (const t of trackers.reverse()) t.restore(); },
  };
}
