// A preload (node --require; worker threads inherit it) that records each CanvasKit surface a report makes, one line
// "<threadId> <width>x<height>" appended to the file named by UI239_SURFACES as it is made. Each law twin is drawn on
// surfaces CanvasKit makes for it (a field twin on two: the render target and the stage; a fallback twin on one), so
// the lines are the twins the report rendered, and the thread each was drawn on (0 is the main thread).
// With UI239_FAIL_SURFACE="<width>x<height>", CanvasKit makes no surface of that size (MakeSurface returns null, as it
// does when it cannot), so the twin that needs it fails. With UI239_EXIT_SURFACE="<width>x<height>", a worker thread
// asked for a surface of that size exits (code 9), as a worker that dies mid-twin; with UI239_THROW_IN_WORKER=1, every
// worker thread throws an uncaught error ("planted uncaught error") as it starts. With UI239_HOLD_SURFACE="<width>x<height>"
// and UI239_HOLD_FOR=<n>, a worker thread asked for that size holds there (the twin unfinished) until n surfaces have
// been made on other worker threads, or 30 s pass, when it records "hold-timeout": a pool that draws twins side by side lets
// the others through. Test-only (UI-239): it changes nothing CanvasKit draws.
/* global SharedArrayBuffer, Atomics */
'use strict';
const fs = require('node:fs');
const Module = require('node:module');
const { threadId } = require('node:worker_threads');

const out = process.env.UI239_SURFACES;
if (!out) throw new Error('countSurfaces.cjs: UI239_SURFACES must name the record file');
const fail = process.env.UI239_FAIL_SURFACE || '';
const exitOn = process.env.UI239_EXIT_SURFACE || '';
const holdOn = process.env.UI239_HOLD_SURFACE || '';
const holdFor = Number(process.env.UI239_HOLD_FOR || 0);
/** Waits, blocking this thread, until `holdFor` surfaces are recorded from other worker threads, or 30 s. */
function hold() {
  const nap = new Int32Array(new SharedArrayBuffer(4));
  const until = Date.now() + 30000;
  for (;;) {
    const others = fs.readFileSync(out, 'utf8').split('\n').filter((l) => /^\d+ /.test(l) && !l.startsWith(`${threadId} `) && !l.startsWith('0 ')).length;
    if (others >= holdFor) return;
    if (Date.now() > until) {
      fs.appendFileSync(out, 'hold-timeout\n');
      return;
    }
    Atomics.wait(nap, 0, 0, 20);
  }
}
if (threadId !== 0 && process.env.UI239_THROW_IN_WORKER === '1') setImmediate(() => { throw new Error('planted uncaught error'); });
const patched = new WeakSet();
const load = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  const exported = load.call(this, request, ...rest);
  if (!/canvaskit-wasm[/\\]bin[/\\]full[/\\]canvaskit\.js$/.test(request) || typeof exported !== 'function') return exported;
  return (...args) => Promise.resolve(exported(...args)).then((ck) => {
    if (!patched.has(ck)) {
      patched.add(ck);
      const make = ck.MakeSurface.bind(ck);
      ck.MakeSurface = (width, height, ...more) => {
        fs.appendFileSync(out, `${threadId} ${width}x${height}\n`);
        if (threadId !== 0 && `${width}x${height}` === exitOn) process.exit(9);
        if (threadId !== 0 && `${width}x${height}` === holdOn) hold();
        return `${width}x${height}` === fail ? null : make(width, height, ...more);
      };
    }
    return ck;
  });
};
