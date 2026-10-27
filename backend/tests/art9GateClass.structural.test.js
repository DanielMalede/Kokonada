'use strict';

// H3a — the CLASS guard for client-supplied biometrics (N1). N1 was one member of a class: the
// "Listen to your heart" socket event took the phone's heart rate, read stored vitals and persisted
// the value with NO consent check, while its sibling biometric_push was gated. Fixing one handler
// leaves the class open, so this scans EVERY boundary that accepts or persists a biometric:
//
//   • socket: every handler in app/sockets that reads a client biometric or reaches an Art.9 sink
//     must call admitHealthProcessing BEFORE the first read or sink;
//   • socket helpers (BE-070 round 2): every module-level function a handler hands its raw payload to
//     names no biometric field at all, so the gated handler body stays the only reader;
//   • REST: every controller that reaches a biometric ingest sink must be gated before it —
//     requireConsent on its route, or getConsentStatus + isCurrentGrant/denialReason inline;
//   • ONE definition of a current grant: staleVersion is read only by the consent service and the
//     gate helper (it used to be hand-copied in five places).
//
// Comments are stripped before any match, and each handler body is cut out by a small scanner that
// counts braces outside strings (template ${ } expressions are scanned as code). The detectors run
// on synthetic sources first, so a guard that silently matches nothing fails instead of passing.

const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '../app');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(APP, f).replace(/\\/g, '/');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

// Index just past the brace that closes the block opened at `open` (a '{'), or -1.
function blockEnd(src, open) {
  const stack = []; // 'code' braces, 'tpl' template literals, 'expr' template ${ } expressions
  let quote = null;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    const top = stack[stack.length - 1];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (top === 'tpl') {
      if (ch === '\\') i += 1;
      else if (ch === '`') stack.pop();
      else if (ch === '$' && src[i + 1] === '{') { stack.push('expr'); i += 1; }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '`') { stack.push('tpl'); continue; }
    if (ch === '{') { stack.push('code'); continue; }
    if (ch === '}') {
      const popped = stack.pop();
      if (popped === 'code' && stack.length === 0) return i + 1;
    }
  }
  return -1;
}

const BIOMETRIC_NAMES = ['heartRate', 'hrv', 'rmssd', 'spo2', 'spO2', 'respirationRate', 'bodyBattery', 'restingHeartRate', 'sleepStages', 'vitals'];
const SOCKET_SINKS = ['handleBiometricReading(', 'resolveHeartContext(', 'recordSample(', 'insertManyAccounted(', 'BiometricLog', 'VitalSample', 'MedicalProfile', 'liveStateOnlineUpdate(', 'stableHR ='];
const REST_SINKS = ['ingestBatch(', 'ingestSummaries(', 'handleWebhook(', 'handleBiometricReading(', 'insertManyAccounted('];

const firstIndex = (body, tokens) => tokens
  .map((t) => (t.endsWith('(') || t.includes(' ') ? body.indexOf(t) : body.search(new RegExp(`\\b${t}\\b`))))
  .filter((i) => i >= 0)
  .reduce((a, b) => Math.min(a, b), Infinity);

// Every inline socket.on('<event>', (<params>) => { ... }) handler, with its params and body.
function socketHandlers(code) {
  const out = [];
  const re = /socket\.on\(\s*'([\w-]+)'\s*,\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g;
  let m;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1;
    const end = blockEnd(code, open);
    out.push({ event: m[1], params: m[2], body: end > 0 ? code.slice(open, end) : null });
  }
  return out;
}

// A socket handler is in the class when it reads a client biometric (a biometric name in its
// params or body) or reaches an Art.9 sink; then admitHealthProcessing must come before both.
function socketViolation({ event, params, body }) {
  if (body === null) return `${event}: body could not be parsed`;
  const readsParam = BIOMETRIC_NAMES.some((n) => new RegExp(`\\b${n}\\b`).test(params));
  const firstUse = Math.min(firstIndex(body, BIOMETRIC_NAMES), firstIndex(body, SOCKET_SINKS));
  if (!readsParam && firstUse === Infinity) return null; // not a biometric boundary
  const gate = body.indexOf('admitHealthProcessing(');
  if (gate < 0) return `${event}: reaches a biometric without admitHealthProcessing`;
  if (gate > firstUse) return `${event}: admitHealthProcessing comes after the first biometric read or sink`;
  return null;
}

// BE-070 round 2 (SEC-266-4, ARCH-266-6): every socket door now hands its raw payload to a module-level
// helper (`_payloadOf`, `_admitRequest`, `_admitEmotionUpdate`) that the handler scan above never reads,
// so a helper that read `payload.heartRate` ahead of the gate would pass it. This follows the payload:
// every module-level function a handler calls with its raw payload parameter, and every one those call
// with their own, may name no biometric field at all — the gated handler body is the only reader.
const PAYLOAD_FIELD_NAMES = [...BIOMETRIC_NAMES, 'hr', 'bpm', 'heart_rate', 'heartrate'];

// Every module-level `function name(params) {`, `const name = (params) => {` and `const name = (params) => expr;`.
function moduleFunctions(code) {
  const out = [];
  const re = /^(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{|^const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*(\{)?/gm;
  let m;
  while ((m = re.exec(code))) {
    const name = m[1] ?? m[3];
    const params = m[2] ?? m[4];
    let body;
    if (m[1] !== undefined || m[5] !== undefined) {
      const open = m.index + m[0].length - 1;
      const end = blockEnd(code, open);
      body = end > 0 ? code.slice(open, end) : null;
    } else {
      const start = m.index + m[0].length;
      const stop = code.indexOf(';\n', start);
      body = code.slice(start, stop > 0 ? stop : undefined);
    }
    out.push({ name, params, body });
  }
  return out;
}

// The module-level functions a handler hands its raw payload to, and the ones those hand it on to.
function payloadHelpers(code) {
  const byName = new Map(moduleFunctions(code).map((f) => [f.name, f]));
  const calledWith = (body, param) => [...body.matchAll(new RegExp(`\\b(\\w+)\\(\\s*${param}\\b`, 'g'))].map((c) => c[1]);
  const found = new Map();
  const follow = (name, from) => {
    const fn = byName.get(name);
    if (!fn || found.has(name)) return;
    found.set(name, { ...fn, from });
    const own = fn.params.split(',')[0].trim();
    if (/^\w+$/.test(own) && fn.body) calledWith(fn.body, own).forEach((n) => follow(n, name));
  };
  for (const h of socketHandlers(code)) {
    const param = h.params.trim();
    if (!/^\w+$/.test(param) || !h.body) continue; // a destructured payload has no single raw name
    calledWith(h.body, param).forEach((n) => follow(n, h.event));
  }
  return [...found.values()];
}

function helperViolation({ name, body, from }) {
  if (body === null) return `${name}: body could not be parsed`;
  const named = PAYLOAD_FIELD_NAMES.filter((n) => new RegExp(`\\b${n}\\b`).test(body));
  return named.length ? `${name} (reached from ${from}): names ${named.join(', ')}` : null;
}

// Every `exports.<name> = (async) (<params>) => { ... }` controller body.
function controllers(code) {
  const out = [];
  const re = /exports\.(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/g;
  let m;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1;
    const end = blockEnd(code, open);
    out.push({ name: m[1], body: end > 0 ? code.slice(open, end) : null });
  }
  return out;
}

function routeGated(routeCode, handler) {
  const re = new RegExp(`router\\.(?:get|post|put|patch|delete)\\(([^;]*?)\\b${handler}\\s*\\)`, 'g');
  const lines = [...routeCode.matchAll(re)];
  return lines.length > 0 && lines.every((l) => /requireConsent\(/.test(l[1]));
}

function restViolation({ name, body }, routeCode) {
  if (body === null) return `${name}: body could not be parsed`;
  const sink = firstIndex(body, REST_SINKS);
  if (sink === Infinity) return null; // not an ingest boundary
  if (routeGated(routeCode, name)) return null;
  const read = body.indexOf('getConsentStatus(');
  const decide = firstIndex(body, ['isCurrentGrant(', 'denialReason(']);
  if (read < 0 || decide === Infinity) return `${name}: reaches an ingest sink with no Art.9 gate`;
  if (read > sink || decide > sink) return `${name}: the Art.9 gate comes after the ingest sink`;
  return null;
}

// BE-205 (SEC-273-1): the Garmin ingest seam gates itself, so a caller that is not a controller (the
// personal lane's pull job) cannot store a biometric without a current grant. Every file that calls it is
// pinned, so a new caller is a visible diff, and inside it the consent read and the decision come before
// the normaliser and the store.
const SEAM_SINKS = ['normalizeGarminSummaries(', 'persistMetrics('];

// The files that call `name(`, its own `function name(` definition aside.
function callersOf(files, name) {
  const call = new RegExp(`\\b${name}\\(`);
  const definition = new RegExp(`function\\s+${name}\\s*\\(`, 'g');
  return files.filter((f) => call.test(f.code.replace(definition, ''))).map((f) => f.file).sort();
}

// The body of `(async) function name(…) { … }`. The parameter list is skipped by counting parentheses,
// so a default such as `{ now = new Date() } = {}` cannot end it early.
function functionBody(code, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(code);
  if (!m) return null;
  let depth = 0;
  let close = -1;
  for (let i = m.index + m[0].length - 1; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')' && --depth === 0) { close = i; break; }
  }
  if (close < 0) return null;
  const open = code.indexOf('{', close);
  if (open < 0 || code.slice(close + 1, open).trim() !== '') return null;
  const end = blockEnd(code, open);
  return end > 0 ? code.slice(open, end) : null;
}

function seamViolation(body) {
  if (body === null) return 'ingestSummaries: body could not be parsed';
  const sink = firstIndex(body, SEAM_SINKS);
  // A seam that reaches neither sink has moved them elsewhere, and this guard would read nothing.
  if (sink === Infinity) return 'ingestSummaries: reaches neither the normaliser nor the store; follow them';
  const read = body.indexOf('getConsentState(');
  const decide = body.indexOf('isCurrentGrant(');
  if (read < 0 || decide < 0) return 'ingestSummaries: reaches the normaliser or the store with no Art.9 gate';
  if (read > sink || decide > sink) return 'ingestSummaries: the Art.9 gate comes after the normaliser or the store';
  return null;
}

const SOCKET_FILES = walk(path.join(APP, 'sockets')).map((f) => ({ file: rel(f), code: stripComments(fs.readFileSync(f, 'utf8')) }));
const CONTROLLER_FILES = walk(path.join(APP, 'controllers')).map((f) => ({ file: rel(f), code: stripComments(fs.readFileSync(f, 'utf8')) }));
const ROUTES = walk(path.join(APP, 'routes')).map((f) => stripComments(fs.readFileSync(f, 'utf8'))).join('\n');
const ALL = walk(APP).map((f) => ({ file: rel(f), code: stripComments(fs.readFileSync(f, 'utf8')) }));

describe('the detectors are not vacuous', () => {
  it('flags an ungated, a late-gated and an ungated-ingest sample; their gated twins pass', () => {
    const ungated = socketHandlers("socket.on('x', async ({ heartRate } = {}) => { state.stableHR = heartRate; });");
    const late = socketHandlers("socket.on('y', async ({ hrv } = {}) => { recordSample(w, hrv); await admitHealthProcessing(uid); });");
    const gated = socketHandlers("socket.on('z', async ({ heartRate } = {}) => { if (!(await admitHealthProcessing(uid))) return; state.stableHR = heartRate; });");
    const inert = socketHandlers("socket.on('w', ({ mode } = {}) => { state.lastMode = mode; });");
    expect(socketViolation(ungated[0])).toMatch(/without admitHealthProcessing/);
    expect(socketViolation(late[0])).toMatch(/after the first/);
    expect(socketViolation(gated[0])).toBeNull();
    expect(socketViolation(inert[0])).toBeNull();

    const ingest = controllers('exports.a = async (req, res, next) => { const r = await store.ingestBatch(req.user._id, req.body); res.json(r); };');
    const inline = controllers("exports.b = async (req, res, next) => { const s = await getConsentStatus(req.user._id, P); if (!isCurrentGrant(s)) return res.status(403).json({ error: 'consent_required' }); await store.ingestBatch(req.user._id, req.body); };");
    const afterSink = controllers('exports.c = async (req, res) => { await store.ingestBatch(1, 2); const s = await getConsentStatus(1, P); denialReason(s); };');
    expect(restViolation(ingest[0], '')).toMatch(/no Art\.9 gate/);
    expect(restViolation(inline[0], '')).toBeNull();
    expect(restViolation(afterSink[0], '')).toMatch(/after the ingest sink/);
    expect(restViolation(ingest[0], "router.post('/a', requireConsent(HEALTH), a);")).toBeNull();
    expect(restViolation(ingest[0], "router.post('/a', a);")).toMatch(/no Art\.9 gate/);
  });

  it('the brace scanner survives template literals, nested ${ } and quotes inside templates', () => {
    const code = "socket.on('t', ({ heartRate } = {}) => { log(`a ${x ? '}' : \"{\"} b ${JSON.stringify({ y: 1 })}`); state.stableHR = heartRate; }); after();";
    const [h] = socketHandlers(code);
    expect(h.body.endsWith('state.stableHR = heartRate; }')).toBe(true);
  });

  it('flags a payload helper that reads a biometric ahead of the gate, one hop away, which the handler scan alone cannot see; its clean twin passes', () => {
    const planted = [
      "socket.on('x', async (payload) => { const { hr } = _admitHeart(payload); if (!(await admitHealthProcessing(uid))) return; state.stableHR = hr; });",
      'function _admitHeart(payload) { return { hr: _payloadOf(payload).heartRate }; }',
      "function _payloadOf(payload) { return payload !== null && typeof payload === 'object' ? payload : {}; }",
    ].join('\n');
    // The handler itself names no biometric before its gate, so the handler scan is blind to the read.
    expect(socketViolation(socketHandlers(planted)[0])).toBeNull();
    const helpers = payloadHelpers(planted);
    expect(helpers.map((h) => h.name).sort()).toEqual(['_admitHeart', '_payloadOf']);
    expect(helpers.map(helperViolation).filter(Boolean)).toEqual(['_admitHeart (reached from x): names heartRate, hr']);

    const clean = planted.replace('{ hr: _payloadOf(payload).heartRate }', '{ reqId: _payloadOf(payload).reqId }');
    expect(payloadHelpers(clean).map(helperViolation).filter(Boolean)).toEqual([]);
    // Arrow helpers are read too, brace-bodied and expression-bodied alike.
    const arrows = "socket.on('y', (p) => { const r = _admitOne(p); });\nconst _admitOne = (p) => _pick(p);\nconst _pick = (p) => { return p.bpm; };";
    expect(payloadHelpers(arrows).map(helperViolation).filter(Boolean)).toEqual(['_pick (reached from _admitOne): names bpm']);
  });

  it('BE-205: the seam check flags an ungated, a late-read and a late-decided seam, and one whose sinks moved; its gated twin passes', () => {
    const seam = (body) => `async function ingestSummaries(userId, items, { now = new Date() } = {}) {${body}}`;
    const gate = 'const { status } = await getConsentState(userId, P); if (!isCurrentGrant(status)) return R;';
    const sinks = 'const m = normalizeGarminSummaries(t, s); await persistMetrics(userId, m, { now });';
    const check = (code) => seamViolation(functionBody(code, 'ingestSummaries'));

    expect(check(seam(`${gate} ${sinks}`))).toBeNull();
    expect(check(seam(sinks))).toMatch(/no Art\.9 gate/);
    expect(check(seam(`${sinks} ${gate}`))).toMatch(/comes after/);
    expect(check(seam(`const m = normalizeGarminSummaries(t, s); ${gate} await persistMetrics(userId, m);`))).toMatch(/comes after/);
    expect(check(seam(`const { status } = await getConsentState(userId, P); await persistMetrics(userId, []); if (!isCurrentGrant(status)) return R;`))).toMatch(/comes after/);
    expect(check(seam(`${gate} await store(userId, items);`))).toMatch(/reaches neither/);
    expect(check('const ingestSummaries = 1;')).toMatch(/could not be parsed/);
    // The default parameter's braces and parentheses do not end the parameter list or open the body.
    expect(functionBody(seam(`${gate} ${sinks}`), 'ingestSummaries').startsWith('{const { status }')).toBe(true);
  });

  it('BE-205: the caller scan finds a new caller and does not count the definition', () => {
    const files = [
      { file: 'controllers/integrationsController.js', code: 'await garminIngest.ingestSummaries(user._id, items);' },
      { file: 'services/wearable/garminIngest.js', code: 'async function ingestSummaries(userId, items) {}\nmodule.exports = { ingestSummaries };' },
      { file: 'workers/garminPersonalPull.js', code: 'const res = await ingestSummaries(userId, admitted.items);' },
      { file: 'services/wearable/mapper.js', code: 'const seam = garminIngest.ingestSummaries;' },
    ];
    expect(callersOf(files, 'ingestSummaries')).toEqual(['controllers/integrationsController.js', 'workers/garminPersonalPull.js']);
  });

  it('the scan found what it guards: ≥8 socket handlers and ≥5 biometric REST controllers', () => {
    const handlers = SOCKET_FILES.flatMap((f) => socketHandlers(f.code));
    expect(handlers.length).toBeGreaterThanOrEqual(8);
    expect(handlers.every((h) => h.body !== null)).toBe(true);
    // Every socket.on in app/sockets is an INLINE arrow the guard can read — a named handler
    // would slip past the body scan, so the count of all registrations must match.
    const registrations = SOCKET_FILES.reduce((n, f) => n + (f.code.match(/socket\.on\(/g) || []).length, 0);
    expect(handlers.length).toBe(registrations);
    // The three door helpers BE-070 added are reached from the handlers' raw payload.
    const helpers = SOCKET_FILES.flatMap((f) => payloadHelpers(f.code));
    expect(helpers.map((h) => h.name)).toEqual(expect.arrayContaining(['_payloadOf', '_admitEmotionUpdate', '_admitRequest']));
    expect(helpers.every((h) => h.body !== null)).toBe(true);

    const ingest = CONTROLLER_FILES.flatMap((f) => controllers(f.code)).filter((c) => firstIndex(c.body || '', REST_SINKS) !== Infinity);
    expect(ingest.map((c) => c.name).sort()).toEqual(expect.arrayContaining(['appleHealthPush', 'garminWebhook', 'healthBatchIngest', 'suuntoWebhook', 'watchHrIngest']));
  });
});

describe('Art.9 gate — the whole class of biometric boundaries', () => {
  it('socket: every handler that reads a client biometric or reaches an Art.9 sink calls admitHealthProcessing before it', () => {
    const violations = SOCKET_FILES.flatMap((f) => socketHandlers(f.code).map(socketViolation).filter(Boolean).map((v) => `${f.file} ${v}`));
    expect(violations).toEqual([]);
  });

  it('socket helpers: no module-level function a door hands its raw payload to names a biometric field (BE-070 round 2)', () => {
    const violations = SOCKET_FILES.flatMap((f) => payloadHelpers(f.code).map(helperViolation).filter(Boolean).map((v) => `${f.file} ${v}`));
    expect(violations).toEqual([]);
  });

  it('REST: every controller that reaches a biometric ingest sink is gated before the sink', () => {
    const violations = CONTROLLER_FILES.flatMap((f) => controllers(f.code).map((c) => restViolation(c, ROUTES)).filter(Boolean).map((v) => `${f.file} ${v}`));
    expect(violations).toEqual([]);
  });

  it('handleBiometricReading is called only from the socket handler and the watch ingest (a pin)', () => {
    const callers = ALL.filter((f) => /\bhandleBiometricReading\(/.test(f.code.replace(/function\s+handleBiometricReading\(/g, '')))
      .map((f) => f.file).sort();
    expect(callers).toEqual(['controllers/integrationsController.js', 'sockets/biometricHandler.js']);
  });

  it('BE-205: ingestSummaries is called only from the Garmin webhook controller (a pin: a new caller is a visible diff)', () => {
    expect(callersOf(ALL, 'ingestSummaries')).toEqual(['controllers/integrationsController.js']);
  });

  it('BE-205: inside ingestSummaries the consent read and isCurrentGrant come before the normaliser and the store', () => {
    const seam = ALL.find((f) => f.file === 'services/wearable/garminIngest.js');
    expect(seam).toBeDefined();
    expect(seamViolation(functionBody(seam.code, 'ingestSummaries'))).toBeNull();
  });

  it('one definition of a current grant: staleVersion is read only in consentState.js', () => {
    const readers = ALL.filter((f) => /\bstaleVersion\b/.test(f.code)).map((f) => f.file).sort();
    expect(readers).toEqual(['services/privacy/consentState.js']);
  });
});
