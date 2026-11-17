// A preload (node --require; worker threads inherit it) that records each CanvasKit surface a report makes, one line
// "<threadId> <width>x<height>" appended to the file named by UI239_SURFACES as it is made. Each law twin is drawn on
// surfaces CanvasKit makes for it (a field twin on two: the render target and the stage; a fallback twin on one), so
// the lines are the twins the report rendered, and the thread each was drawn on (0 is the main thread).
// With UI239_FAIL_SURFACE="<width>x<height>", CanvasKit makes no surface of that size (MakeSurface returns null, as it
// does when it cannot), so the twin that needs it fails. With UI239_EXIT_SURFACE="<width>x<height>", a worker thread
// asked for a surface of that size exits (code 9), as a worker that dies mid-twin; with UI239_THROW_IN_WORKER=1, every
// worker thread throws an uncaught error ("planted uncaught error") as it starts. Test-only (UI-239): it changes nothing
// CanvasKit draws.
'use strict';
const fs = require('node:fs');
const Module = require('node:module');
const { threadId } = require('node:worker_threads');

const out = process.env.UI239_SURFACES;
if (!out) throw new Error('countSurfaces.cjs: UI239_SURFACES must name the record file');
const fail = process.env.UI239_FAIL_SURFACE || '';
const exitOn = process.env.UI239_EXIT_SURFACE || '';
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
        return `${width}x${height}` === fail ? null : make(width, height, ...more);
      };
    }
    return ck;
  });
};
