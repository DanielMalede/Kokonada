// A preload (node --require) that counts the CanvasKit surfaces a report makes, and writes the count to the file named
// by UI239_SURFACES when the process exits. Each law twin is drawn on surfaces CanvasKit makes for it (a field twin on
// two: the render target and the stage; a fallback twin on one), so the count is how many twins the report rendered.
// Test-only (UI-239): it wraps CanvasKit's MakeSurface and changes nothing it draws.
'use strict';
const fs = require('node:fs');
const Module = require('node:module');

const out = process.env.UI239_SURFACES;
if (!out) throw new Error('countSurfaces.cjs: UI239_SURFACES must name the count file');
let surfaces = 0;
const patched = new WeakSet();
const load = Module._load;
Module._load = function patchedLoad(request, ...rest) {
  const exported = load.call(this, request, ...rest);
  if (!/canvaskit-wasm[/\\]bin[/\\]full[/\\]canvaskit\.js$/.test(request) || typeof exported !== 'function') return exported;
  return (...args) => Promise.resolve(exported(...args)).then((ck) => {
    if (!patched.has(ck)) {
      patched.add(ck);
      const make = ck.MakeSurface.bind(ck);
      ck.MakeSurface = (...a) => {
        surfaces += 1;
        return make(...a);
      };
    }
    return ck;
  });
};
process.on('exit', () => fs.writeFileSync(out, String(surfaces)));
