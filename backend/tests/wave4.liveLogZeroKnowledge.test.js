'use strict';

// W4-D03 — the live lane's DEBUG log lines carried a numeric heart rate.
//
// The defect, read off the source (`app/sockets/biometricHandler.js`), on THREE lines, not the one
// the backlog row named:
//
//   [generate] start trigger=.. hr=${state.stableHR} activity=.. mode=.. reqId=..          (:842)
//   [handleBiometric] immediate hr=${effectiveHR} activity=.. bandChanged=.. → recalibrate (:1589)
//   [heart] generate hr=${ctx.heartRate} activity=.. source=.. reqId=..                    (:1748)
//
// All three are `log()`, i.e. `if (DEBUG) console.log` — on in `development` and under
// DEBUG_PLAYLIST=1, silent in production. That gating is why W4-D03 ranked below W4-D10 (an
// unconditional write), but §0.2.2 and ADR-0005 both say NO numeric vital in ANY log, not "no
// numeric vital in production logs" — a developer box running against real watch data is exactly
// where an Art.9 value lands in a terminal scrollback and a bug report.
//
// Measured while pinning this: `effectiveHR` is the KALMAN-FILTERED level, so :1589 printed
// `hr=91.9` / `hr=130.09` — a vital at higher precision than the device itself reported. The row's
// "prints a raw vital" understated it.
//
// The fix is the row's own DoD: the coarse band instead of the number. `bandFromHeartRate` is the
// projection already imported by this file and already the vocabulary the shadow buffer is keyed
// by (`bio:<band>:<activity>`), so the lines still answer the operational question they exist for
// — "which band did this run on?" — which is the question the band-keyed buffer, the trigger and
// the targets all actually turn on. The number was never the load-bearing part.
//
// Deliberately NOT changed: `[gen.targets]` (:1144) keeps its numbers. bpmCenter/energy/valence are
// DERIVED TARGETS, which §0.2.2 explicitly admits ("coarse bands/derived targets only"), and §0.2.5
// pins that line as a consumer of the frozen targets shape.
//
// The tripwire below is the part that generalises: a helper only helps the caller who chooses to
// use it, so the enforcement is a scan of EVERY log call site in the file for a vital-valued
// identifier — the same "one malformed producer away" lesson `wave4.ingestLogZeroKnowledge.test.js`
// records for the closed metric vocabulary.

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
// Must be set BEFORE the handler is required: `DEBUG` is captured once at module load.
process.env.DEBUG_PLAYLIST = '1';

const fs   = require('fs');
const path = require('path');

const {
  handleBiometricReading,
  _resetDebounceState,
  _hrBand,
} = require('../app/sockets/biometricHandler');
const { bandFromHeartRate, BAND_LOWER_CUT } = require('../app/services/moodDescriptors');

const HANDLER_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'sockets', 'biometricHandler.js'), 'utf8',
);

// W4-D06: the streaming lane arms a 60 s debounce timer. Nothing here takes the debounce path
// (every reading is `immediate`), but the release is cheap and the guard is run-level.
afterEach(() => { _resetDebounceState(); });

// ── The projection ─────────────────────────────────────────────────────────────
describe('_hrBand — the values-free projection a log line may carry', () => {
  it('maps a usable reading to the coarse serving band', () => {
    expect(_hrBand(48)).toBe('resting');
    expect(_hrBand(89)).toBe('resting');
    expect(_hrBand(90)).toBe('active');
    expect(_hrBand(119)).toBe('active');
    expect(_hrBand(120)).toBe('peak');
    expect(_hrBand(195)).toBe('peak');
  });

  it('is the SAME projection the buffer is keyed by — not a second copy of the cuts', () => {
    // A duplicated cut is precisely D11 (trigger keyed on a delta, buffer keyed on a band).
    for (let hr = 1; hr <= 300; hr += 1) {
      expect(_hrBand(hr)).toBe(bandFromHeartRate(hr));
    }
    // and it is anchored to the shared constant, so moving a cut moves both together
    expect(_hrBand(BAND_LOWER_CUT.active - 1)).toBe('resting');
    expect(_hrBand(BAND_LOWER_CUT.active)).toBe('active');
    expect(_hrBand(BAND_LOWER_CUT.peak - 1)).toBe('active');
    expect(_hrBand(BAND_LOWER_CUT.peak)).toBe('peak');
  });

  it('says "none" for every unusable reading rather than a band or a throw', () => {
    // `bandFromHeartRate` returns null here; a template literal would print "null", which reads
    // like a value. 'none' matches the vocabulary W4-D10 established for the ingest receipt.
    for (const bad of [null, undefined, NaN, Infinity, -Infinity, 0, -5, '', 'abc', {}, [], () => {}]) {
      expect(_hrBand(bad)).toBe('none');
    }
  });

  it('NEVER emits a digit, for any input — the property the log line depends on', () => {
    const inputs = [null, undefined, NaN, Infinity, '', 'abc', {}, 0, -1, 0.5, 1e9];
    for (let hr = 1; hr <= 300; hr += 1) inputs.push(hr, hr + 0.37);
    for (const hr of inputs) expect(String(_hrBand(hr))).not.toMatch(/\d/);
  });
});

// ── The line the defect lived on, driven through the REAL handler ──────────────
//
// No mocks: `handleBiometricReading` is exercised end to end (adapter → anomaly filter → trigger),
// so what is asserted is the string the running server would actually print. The fire-and-forget
// persistence/posterior side effects swallow their own errors without a DB, which is why this
// needs no harness — see the `console.error` mute below, which only hides that expected noise.
describe('[handleBiometric] immediate — the live recalibration receipt', () => {
  let logSpy;
  let errSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { logSpy.mockRestore(); errSpy.mockRestore(); });

  // A ramp across both cuts. The values are the DEVICE readings; the filtered level the line used
  // to print lands at 62 / 91.9 / 130.09 — measured, and none of them is a substring of any other
  // token on the line, which is what makes the "no digit at all" assertion below meaningful.
  const RAMP = [62, 70, 80, 92, 104, 118, 130, 142];

  function driveRamp(socketId) {
    const socket = {
      id: socketId,
      data: { user: { _id: '5f9d88b8b54764421b7156da' } },
      emit: jest.fn(),
      on:   jest.fn(),
    };
    const t0 = Date.parse('2026-08-22T12:00:00Z');
    RAMP.forEach((heartRate, i) => {
      const at = t0 + i * 60_000;
      handleBiometricReading(
        socket, 'garmin',
        { heartRate, activityType: 'running', startTimeLocal: new Date(at).toISOString() },
        { immediate: true, now: at },
      );
    });
    return logSpy.mock.calls
      .map((c) => c.join(' '))
      .filter((l) => l.includes('[handleBiometric] immediate'));
  }

  it('ZERO-KNOWLEDGE: carries the coarse band and NO digit anywhere', () => {
    const lines = driveRamp('sock-zk');
    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      // The whole line — not just the field that leaked. Every other token on it is a name or a
      // boolean, so a digit appearing here can only be a vital (or a regression that added one).
      expect(line).not.toMatch(/\d/);
      expect(line).not.toMatch(/\bhr=/);
      expect(line).toMatch(/\bband=(resting|active|peak|none)\b/);
    }
  });

  it('still reports the band CHANGE it exists to explain, across both cuts', () => {
    const lines = driveRamp('sock-bands');

    // The ramp crosses resting→active→peak, so the receipt names all three bands in order and
    // says which of them was a change. Losing the number cost the line nothing operationally.
    expect(lines.map((l) => l.match(/band=(\w+)/)[1])).toEqual(['resting', 'active', 'peak']);
    expect(lines[0]).toMatch(/bandChanged=false/);   // first reading: no baseline to change from
    expect(lines[1]).toMatch(/bandChanged=true/);
    expect(lines[2]).toMatch(/bandChanged=true/);
    for (const line of lines) expect(line).toMatch(/activityChanged=(true|false)/);
  });

  it('stays inside the band vocabulary — no free-form value can reach the line', () => {
    const lines = driveRamp('sock-vocab');
    for (const line of lines) {
      const band = line.match(/band=(\S+)/)[1];
      expect(['resting', 'active', 'peak', 'none']).toContain(band);
    }
  });
});

// ── The generalisation ─────────────────────────────────────────────────────────
describe('TRIPWIRE: no log call site in biometricHandler.js names a vital', () => {
  // Every `log(...)` / `console.*(...)` statement in the file, as source text.
  const CALL_SITES = HANDLER_SRC
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => /(^|[^.\w])(log|console\.(log|warn|error|info))\s*\(/.test(text));

  // Identifiers that HOLD a heart rate or another Art.9 scalar in this file. Deliberately does NOT
  // include `targets.bpmCenter`/`energy*`/`valence*`: those are derived targets, which §0.2.2
  // admits and §0.2.5 pins on the `[gen.targets]` line.
  const VITAL_IDENT = /\b(stableHR|effectiveHR|pendingHR|servedHR|latchHR|heartRate|hrv|spO2|respirationRate)\b/;

  // The rule is not "a vital identifier never appears in a log line" — the band IS computed from
  // one. It is "a vital may reach a log ONLY through the approved projection", so an interpolation
  // mentioning a vital must be exactly `_hrBand(...)` and nothing else. That distinction is the
  // whole guard: `${_hrBand(effectiveHR)}` is the fix, `${_hrBand(effectiveHR)} raw=${effectiveHR}`
  // is the regression, and a substring match cannot tell them apart.
  const interpolations = (text) => [...text.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
  const leaks = (text) => interpolations(text)
    .filter((expr) => VITAL_IDENT.test(expr) && !/^_hrBand\(.*\)$/.test(expr));

  it('found the call sites it means to guard (the scan is not vacuously passing)', () => {
    expect(CALL_SITES.length).toBeGreaterThan(25);
    expect(CALL_SITES.some(({ text }) => text.includes('[handleBiometric] immediate'))).toBe(true);
    expect(CALL_SITES.some(({ text }) => text.includes('[generate] start'))).toBe(true);
    expect(CALL_SITES.some(({ text }) => text.includes('[heart] generate'))).toBe(true);
  });

  it('no call site interpolates a vital except through _hrBand()', () => {
    const offenders = CALL_SITES
      .flatMap(({ line, text }) => leaks(text).map((expr) => `${line}: \${${expr}}`));
    expect(offenders).toEqual([]);
  });

  it('the guard above would CATCH a raw vital added next to the band (not vacuous)', () => {
    // The exact regression it exists to stop, checked against the rule rather than the file.
    const regressed = 'log(`[handleBiometric] immediate band=${_hrBand(effectiveHR)} raw=${effectiveHR}`);';
    expect(leaks(regressed)).toEqual(['effectiveHR']);
    // ...while the shipped form is clean, and a derived target stays allowed.
    expect(leaks('log(`band=${_hrBand(effectiveHR)}`);')).toEqual([]);
    expect(leaks('log(`bpmCenter=${playlist.targets?.bpmCenter}`);')).toEqual([]);
  });

  it('no call site prints an `hr=` field at all', () => {
    const offenders = CALL_SITES
      .filter(({ text }) => /\bhr=\$\{/.test(text))
      .map(({ line, text }) => `${line}: ${text.trim()}`);
    expect(offenders).toEqual([]);
  });

  it('the three lines that leaked now carry the band instead', () => {
    for (const tag of ['[handleBiometric] immediate', '[generate] start', '[heart] generate']) {
      const site = CALL_SITES.find(({ text }) => text.includes(tag));
      expect(site.text).toMatch(/band=\$\{_?hrBand\(/);
    }
  });
});
