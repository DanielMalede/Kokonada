'use strict';

// BE-245 (DEC-047, ADR-0018) — the Garmin music fence is CLOSED by default and cannot be opened at run time.
//
// Garmin's Health API terms do not let its data shape the music until Garmin says so in writing. The fence is a
// frozen code constant, not an env var or a flag: turning it on is a reviewed PR that flips one literal, with
// Garmin's written permission filed (OPS-331), compliance-auditor's reading and the owner's own approval quoted
// at its head (T12). These pins are the tripwire on that literal and on everything a run could use to bypass it.
//
// Real semantics: the REAL module, required as the app requires it, and the REAL source text evaluated with the
// literal swapped, so "only `=== true` opens" is measured on the shipped code, not on a copy of it.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FENCE_FILE = path.join(__dirname, '../app/services/wearable/garminMusicFence.js');
const SOURCE = fs.readFileSync(FENCE_FILE, 'utf8');
const LITERAL = /^const GARMIN_MAY_SHAPE_MUSIC = false;$/m;

// The module's source, evaluated in a fresh context with the switch's literal replaced by `literal`.
function evaluateWith(literal) {
  const src = SOURCE.replace(LITERAL, `const GARMIN_MAY_SHAPE_MUSIC = ${literal};`);
  if (literal !== 'false') expect(src).not.toEqual(SOURCE); // the swap really happened
  const module = { exports: {} };
  vm.runInNewContext(src, { module, exports: module.exports, require, process, Object, Array });
  return module.exports;
}

const fence = require('../app/services/wearable/garminMusicFence');

describe('the switch is closed by default', () => {
  it('garminMayShapeMusic() is false, Garmin is fenced, and generation queries exclude its rows', () => {
    expect(fence.GARMIN_MAY_SHAPE_MUSIC).toBe(false);
    expect(fence.garminMayShapeMusic()).toBe(false);
    expect(fence.fencedSources()).toEqual(['garmin']);
    expect(fence.generationVitalQuery()).toEqual({ source: { $nin: ['garmin'] } });
  });

  it('the tripwire: the shipped source carries the literal `false`, exactly once, and nothing else assigns it', () => {
    expect(SOURCE.match(new RegExp(LITERAL.source, 'gm'))).toHaveLength(1);
    expect(SOURCE.match(/GARMIN_MAY_SHAPE_MUSIC\s*=[^=]/g)).toHaveLength(1);
  });

  it('the header says how it may be turned on: permission filed (OPS-331), compliance reading, the owner at the head (T12)', () => {
    const header = SOURCE.slice(0, SOURCE.indexOf('const GARMIN_MAY_SHAPE_MUSIC'));
    for (const needle of ['OPS-331', 'compliance-auditor', 'T12', 'DEC-047', 'BE-031']) expect(header).toContain(needle);
  });
});

describe('only the literal `true` opens it', () => {
  it('`true`: open, nothing fenced, and the generation query is the empty object (permitted reads byte-identical)', () => {
    const open = evaluateWith('true');
    expect(open.garminMayShapeMusic()).toBe(true);
    expect(open.fencedSources()).toEqual([]);
    expect(open.generationVitalQuery()).toEqual({});
    expect(Object.keys(open.generationVitalQuery())).toHaveLength(0);
  });

  it.each([['1'], ["'true'"], ["'yes'"], ['{}'], ['[]'], ['new Boolean(true)'], ['"false"'], ['undefined'], ['null']])(
    'a truthy or look-alike value %s keeps it closed',
    (literal) => {
      const closed = evaluateWith(literal);
      expect(closed.garminMayShapeMusic()).toBe(false);
      expect(closed.fencedSources()).toEqual(['garmin']);
      expect(closed.generationVitalQuery()).toEqual({ source: { $nin: ['garmin'] } });
    },
  );

  it('the evaluator is not vacuous: `false` evaluated the same way is closed', () => {
    expect(evaluateWith('false').garminMayShapeMusic()).toBe(false);
  });
});

describe('no run-time override', () => {
  afterEach(() => {
    delete process.env.GARMIN_MAY_SHAPE_MUSIC;
    delete process.env.GARMIN_MUSIC_FENCE;
  });

  it('an env var does not open it (the module reads no environment at all)', () => {
    process.env.GARMIN_MAY_SHAPE_MUSIC = 'true';
    process.env.GARMIN_MUSIC_FENCE = 'off';
    jest.isolateModules(() => {
      const fresh = require('../app/services/wearable/garminMusicFence');
      expect(fresh.garminMayShapeMusic()).toBe(false);
      expect(fresh.generationVitalQuery()).toEqual({ source: { $nin: ['garmin'] } });
    });
    expect(SOURCE).not.toMatch(/process\.env|process\[|require\(/);
  });

  it('the module is frozen: its exports cannot be reassigned or extended', () => {
    expect(Object.isFrozen(fence)).toBe(true);
    expect(() => { 'use strict'; fence.garminMayShapeMusic = () => true; }).toThrow(TypeError);
    expect(() => { 'use strict'; fence.GARMIN_MAY_SHAPE_MUSIC = true; }).toThrow(TypeError);
    expect(() => { 'use strict'; fence.extra = 1; }).toThrow(TypeError);
    expect(fence.garminMayShapeMusic()).toBe(false);
  });

  it('a caller that mutates what it was handed does not move the fence', () => {
    fence.fencedSources().length = 0;
    fence.generationVitalQuery().source.$nin.length = 0;
    expect(fence.fencedSources()).toEqual(['garmin']);
    expect(fence.generationVitalQuery()).toEqual({ source: { $nin: ['garmin'] } });
  });

  it('exports exactly the switch and its three readers: nothing that builds an open fence', () => {
    expect(Object.keys(fence).sort()).toEqual(['GARMIN_MAY_SHAPE_MUSIC', 'fencedSources', 'garminMayShapeMusic', 'generationVitalQuery']);
  });
});
