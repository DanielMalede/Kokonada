'use strict';

// H3a — the CLASS guard for client-supplied biometrics (N1). N1 was one member of a class: the
// "Listen to your heart" socket event took the phone's heart rate, read stored vitals and persisted
// the value with NO consent check, while its sibling biometric_push was gated. Fixing one handler
// leaves the class open, so this scans EVERY boundary that accepts or persists a biometric:
//
//   • socket: every handler in app/sockets that reads a client biometric or reaches an Art.9 sink
//     must call admitHealthProcessing BEFORE the first read or sink;
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

  it('the scan found what it guards: ≥8 socket handlers and ≥5 biometric REST controllers', () => {
    const handlers = SOCKET_FILES.flatMap((f) => socketHandlers(f.code));
    expect(handlers.length).toBeGreaterThanOrEqual(8);
    expect(handlers.every((h) => h.body !== null)).toBe(true);
    // Every socket.on in app/sockets is an INLINE arrow the guard can read — a named handler
    // would slip past the body scan, so the count of all registrations must match.
    const registrations = SOCKET_FILES.reduce((n, f) => n + (f.code.match(/socket\.on\(/g) || []).length, 0);
    expect(handlers.length).toBe(registrations);

    const ingest = CONTROLLER_FILES.flatMap((f) => controllers(f.code)).filter((c) => firstIndex(c.body || '', REST_SINKS) !== Infinity);
    expect(ingest.map((c) => c.name).sort()).toEqual(expect.arrayContaining(['appleHealthPush', 'garminWebhook', 'healthBatchIngest', 'suuntoWebhook', 'watchHrIngest']));
  });
});

describe('Art.9 gate — the whole class of biometric boundaries', () => {
  it('socket: every handler that reads a client biometric or reaches an Art.9 sink calls admitHealthProcessing before it', () => {
    const violations = SOCKET_FILES.flatMap((f) => socketHandlers(f.code).map(socketViolation).filter(Boolean).map((v) => `${f.file} ${v}`));
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

  it('one definition of a current grant: staleVersion is read only in consent.js and healthConsentGate.js', () => {
    const readers = ALL.filter((f) => /\bstaleVersion\b/.test(f.code)).map((f) => f.file).sort();
    expect(readers).toEqual(['services/privacy/consent.js', 'services/privacy/healthConsentGate.js']);
  });
});
