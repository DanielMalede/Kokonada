/// <reference types="node" />
// QA-110: gesture fakes that fire real handler callbacks.
//
// The unit project's gesture-handler mock (jest.setup.js:61-68) is a Proxy: every builder call returns
// another Proxy and every callback is swallowed, so a plate's gesture-to-commit path never runs in
// jest. This fake replaces Gesture.Tap / Gesture.Pan / GestureDetector on that mock (capture-and-
// restore). Its builders carry exactly the public methods of the real RNGH 3.0.2 classes (pinned by
// realBuilderMethods(), which re-reads the library source), so a misspelt or removed method throws as
// it would on device. A mounted GestureDetector registers its gesture; tap() and pan() fire the
// recorded callbacks in RNGH's order: onBegin, onStart, onUpdate/onChange per move, onEnd(e, success),
// onFinalize(e, success). A tap past its maxDuration (RNGH default 500 ms) or maxDistance fails
// before activation: onBegin, then onFinalize(e, false), and no onEnd.

import React, { useEffect } from 'react';
import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { Patcher } from './patch';
import { APP_ROOT } from './guards/productionImports';

const BASE = [
  'toGestureArray', 'initialize', 'prepare', 'withRef', 'onBegin', 'onStart', 'onEnd', 'onFinalize', 'onTouchesDown',
  'onTouchesMove', 'onTouchesUp', 'onTouchesCancelled', 'enabled', 'shouldCancelWhenOutside', 'hitSlop', 'activeCursor',
  'mouseButton', 'runOnJS', 'simultaneousWithExternalGesture', 'requireExternalGestureToFail', 'blocksExternalGesture',
  'withTestId', 'cancelsTouchesInView',
];
const TAP = ['minPointers', 'numberOfTaps', 'maxDistance', 'maxDuration', 'maxDelay', 'maxDeltaX', 'maxDeltaY'];
const CONTINUOUS = ['onUpdate', 'onChange', 'manualActivation'];
const PAN = [
  'activeOffsetY', 'activeOffsetX', 'failOffsetY', 'failOffsetX', 'minPointers', 'maxPointers', 'minDistance', 'minVelocity',
  'minVelocityX', 'minVelocityY', 'averageTouches', 'enableTrackpadTwoFingerGesture', 'activateAfterLongPress',
];
const unique = (xs: string[]) => [...new Set(xs)];
export const FAKE_BUILDER_METHODS = { Tap: unique([...BASE, ...TAP]), Pan: unique([...BASE, ...CONTINUOUS, ...PAN]) };

/** The public methods of RNGH's real Tap and Pan gesture classes, read from the installed source. */
export function realBuilderMethods(): { Tap: string[]; Pan: string[] } {
  const dir = path.join(APP_ROOT, 'node_modules/react-native-gesture-handler/src/handlers/gestures');
  const byClass: Record<string, string[]> = {};
  for (const f of ['gesture.ts', 'tapGesture.ts', 'panGesture.ts']) {
    const sf = ts.createSourceFile(f, fs.readFileSync(path.join(dir, f), 'utf8'), ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (!ts.isClassDeclaration(st) || !st.name) continue;
      byClass[st.name.text] = st.members
        .filter((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && !!m.name && ts.isIdentifier(m.name))
        .filter((m) => !(ts.getCombinedModifierFlags(m) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)))
        .map((m) => (m.name as ts.Identifier).text);
    }
  }
  const of = (...names: string[]) => unique(names.flatMap((n) => byClass[n] ?? [])).sort();
  return { Tap: of('Gesture', 'BaseGesture', 'TapGesture'), Pan: of('Gesture', 'BaseGesture', 'ContinousBaseGesture', 'PanGesture') };
}

type Callback = (e: Record<string, unknown>, success?: boolean) => void;
export interface FakeGesture {
  readonly kind: 'Tap' | 'Pan';
  readonly config: Record<string, unknown>;
  readonly callbacks: Record<string, Callback>;
}

function makeBuilder(kind: 'Tap' | 'Pan'): FakeGesture {
  const g: any = { kind, config: {}, callbacks: {} };
  for (const m of FAKE_BUILDER_METHODS[kind]) {
    g[m] = (...args: unknown[]) => {
      if (m === 'toGestureArray') return [g];
      if (m === 'initialize' || m === 'prepare') return undefined;
      if (/^on[A-Z]/.test(m)) g.callbacks[m] = args[0];
      else g.config[m] = args.length <= 1 ? args[0] : args;
      return g;
    };
  }
  return g;
}

// RNGH State values (src/State.ts).
const STATE = { BEGAN: 2, FAILED: 1, ACTIVE: 4, END: 5 } as const;

export interface TapInput { x: number; y: number; durationMs?: number; moveBy?: { x: number; y: number } }
export interface GestureFakes {
  /** Mounted GestureDetectors. */
  detectors(): number;
  /** Fire a tap on a mounted detector (by index) or a gesture object. */
  tap(target: number | FakeGesture, input: TapInput): void;
  /** Fire a pan through the given points. */
  pan(target: number | FakeGesture, points: Array<{ x: number; y: number }>): void;
  lastFinalize(): { success: boolean } | null;
  restore(): void;
}

export function installGestureFakes(): GestureFakes {
  const patcher = new Patcher();
  const rngh = require('react-native-gesture-handler') as Record<string, any>;
  const mounted: FakeGesture[] = [];
  let finalized: { success: boolean } | null = null;

  patcher.set(rngh.Gesture, 'Tap', () => makeBuilder('Tap'));
  patcher.set(rngh.Gesture, 'Pan', () => makeBuilder('Pan'));
  patcher.set(rngh, 'GestureDetector', ({ gesture, children }: { gesture: FakeGesture; children: React.ReactNode }) => {
    useEffect(() => {
      mounted.push(gesture);
      return () => { mounted.splice(mounted.indexOf(gesture), 1); };
    }, [gesture]);
    return <>{children}</>;
  });

  const resolve = (target: number | FakeGesture): FakeGesture => {
    const g = typeof target === 'number' ? mounted[target] : target;
    if (!g) throw new Error(`QA-110: no mounted gesture at ${String(target)}`);
    return g;
  };
  const call = (g: FakeGesture, name: string, e: Record<string, unknown>, success?: boolean) => {
    if (name === 'onFinalize') finalized = { success: !!success };
    g.callbacks[name]?.(e, success);
  };
  const event = (x: number, y: number, state: number, extra: Record<string, unknown> = {}) =>
    ({ x, y, absoluteX: x, absoluteY: y, numberOfPointers: 1, pointerType: 0, state, handlerTag: 1, ...extra });

  return {
    detectors: () => mounted.length,
    tap(target, input) {
      const g = resolve(target);
      const maxDuration = (g.config.maxDuration as number | undefined) ?? 500;
      const maxDistance = g.config.maxDistance as number | undefined;
      const moved = input.moveBy ? Math.hypot(input.moveBy.x, input.moveBy.y) : 0;
      const failed = (input.durationMs ?? 50) > maxDuration || (maxDistance != null && moved > maxDistance);
      const end = { x: input.x + (input.moveBy?.x ?? 0), y: input.y + (input.moveBy?.y ?? 0) };
      call(g, 'onBegin', event(input.x, input.y, STATE.BEGAN));
      if (failed) { call(g, 'onFinalize', event(end.x, end.y, STATE.FAILED), false); return; }
      call(g, 'onStart', event(end.x, end.y, STATE.ACTIVE));
      call(g, 'onEnd', event(end.x, end.y, STATE.END), true);
      call(g, 'onFinalize', event(end.x, end.y, STATE.END), true);
    },
    pan(target, points) {
      const g = resolve(target);
      if (points.length === 0) throw new Error('QA-110: a pan needs at least one point');
      const [p0] = points;
      call(g, 'onBegin', event(p0.x, p0.y, STATE.BEGAN));
      call(g, 'onStart', event(p0.x, p0.y, STATE.ACTIVE, { translationX: 0, translationY: 0 }));
      let prev = p0;
      for (const p of points.slice(1)) {
        const move = { translationX: p.x - p0.x, translationY: p.y - p0.y, velocityX: 0, velocityY: 0 };
        call(g, 'onUpdate', event(p.x, p.y, STATE.ACTIVE, move));
        call(g, 'onChange', event(p.x, p.y, STATE.ACTIVE, { ...move, changeX: p.x - prev.x, changeY: p.y - prev.y }));
        prev = p;
      }
      const last = points[points.length - 1];
      const fin = { translationX: last.x - p0.x, translationY: last.y - p0.y };
      call(g, 'onEnd', event(last.x, last.y, STATE.END, fin), true);
      call(g, 'onFinalize', event(last.x, last.y, STATE.END, fin), true);
    },
    lastFinalize: () => finalized,
    restore() {
      mounted.splice(0);
      patcher.restore();
    },
  };
}
