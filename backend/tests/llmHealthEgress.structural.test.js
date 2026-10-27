'use strict';

// BE-221 — the structural half of "no health information reaches Groq". llmHealthEgress.test.js
// proves the requests that the known callers send; this proves there are no others. Every Groq
// request leaves through llmCall.chatJson, reached only through geminiEngine._generate or
// llmClient.generateJson, so the references to those names under backend/app ARE the egress
// surface — and the provider's host and path appear nowhere but llmCall.js, so no second client can
// talk to Groq around them. A new reference fails this suite until someone adds it here and, with
// it, a request-body test in llmHealthEgress.test.js.
//
// Discovery reads the real source tree (.js, .mjs, .cjs). Identifier references are counted with
// comments stripped, so a comment can neither hide a reference nor invent one; the host and path
// are searched in the raw text, comments included, which is the stricter reading. Each check is then
// run on a mutated copy of a real file to prove it is not vacuous (RA-4 on #279).

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../app');
const NAMES = ['chatJson', '_generate', 'generateJson', '_callLlm'];
const TRANSPORT = ['api.groq.com', 'LLM_BASE_URL', 'chat/completions'];

// file (relative to backend/app) → name → number of identifier references: definitions, imports,
// exports and calls alike.
const ALLOWED = {
  'services/llmCall.js':                      { chatJson: 2 },
  'services/llmClient.js':                    { chatJson: 2, generateJson: 2 },
  'services/geminiEngine.js':                 { chatJson: 2, _generate: 3, _callLlm: 2 },
  'services/discovery/captionService.js':     { generateJson: 1 },
  'services/features/llmEstimatorAdapter.js': { generateJson: 1 },
  'workers/embedding.worker.js':              { generateJson: 1 },
};
const TRANSPORT_ALLOWED = { 'services/llmCall.js': ['api.groq.com', 'LLM_BASE_URL', 'chat/completions'] };

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function references(src) {
  const code = stripComments(src);
  const out = {};
  for (const name of NAMES) {
    const n = (code.match(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g')) || []).length;
    if (n) out[name] = n;
  }
  return out;
}

function transportStrings(src) {
  return TRANSPORT.filter((t) => src.includes(t));
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(c|m)?js$/.test(e.name) ? [p] : [];
  });
}

function scan(fn) {
  const found = {};
  for (const file of walk(APP)) {
    const hit = fn(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(hit) ? hit.length : Object.keys(hit).length) found[path.relative(APP, file).split(path.sep).join('/')] = hit;
  }
  return found;
}

const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
function inject(src, anchor, text) {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`anchor not found: ${anchor}`);
  return src.slice(0, at) + text + src.slice(at);
}

// The guarded properties, as functions, so the same check runs on the real file and on a mutated copy.
const captionBans = (src) => ['hrBand', 'bpmCenter', 'bio:'].filter((t) => src.includes(t));
const engineBans = (src) => ['_buildBiometricPrompt', '_resolveHrBand', 'intensity band']
  .filter((t) => new RegExp(t, 'i').test(stripComments(src)));
function captionArgs(src) {
  const code = stripComments(src);
  const at = code.indexOf('captionService.captionDiscovery(');
  if (at < 0) return null;
  return code.slice(at, code.indexOf('});', at) + 3);
}
const ARG_BANS = /hrBand|targets|latestActivity|stableHR/;

describe('the Groq egress surface is exactly the allow-list', () => {
  it('every reference to chatJson, _generate, generateJson and _callLlm under backend/app is pinned', () => {
    expect(scan(references)).toEqual(ALLOWED);
  });

  it('the provider host, LLM_BASE_URL and the chat/completions path appear only in llmCall.js', () => {
    expect(scan(transportStrings)).toEqual(TRANSPORT_ALLOWED);
  });

  it('not vacuous: a second _callLlm in the real geminiEngine.js changes its count', () => {
    const real = read('services/geminiEngine.js');
    const mutated = inject(real, '  const params = buildBioParams(ctx, musicProfile);', '  await _callLlm(String(ctx.heartRate));\n');
    expect(references(real)).toEqual(ALLOWED['services/geminiEngine.js']);
    expect(references(mutated)).not.toEqual(ALLOWED['services/geminiEngine.js']);
  });

  it('not vacuous: a direct Groq call pasted into the real captionService.js is found', () => {
    const real = read('services/discovery/captionService.js');
    const mutated = `${real}\nrequire('axios').post('https://api.groq.com/openai/v1/chat/completions', {});\n`;
    expect(transportStrings(real)).toEqual([]);
    expect(transportStrings(mutated)).toEqual(['api.groq.com', 'chat/completions']);
  });

  it('not vacuous: a commented-out call is not counted', () => {
    const real = read('services/discovery/captionService.js');
    expect(references(`${real}\n// llmClient.generateJson(prompt)\n/* _generate(x) */\n`)).toEqual(references(real));
  });
});

describe('the health-derived inputs are gone from the prompt builders', () => {
  it('captionService.js names no heart-rate band, no tempo target and no bio: key', () => {
    expect(captionBans(read('services/discovery/captionService.js'))).toEqual([]);
  });

  it('geminiEngine.js no longer defines the biometric prompt or its band resolver', () => {
    expect(engineBans(read('services/geminiEngine.js'))).toEqual([]);
  });

  it('the handler hands the caption service no band, no targets and no watch activity', () => {
    const args = captionArgs(read('sockets/biometricHandler.js'));
    expect(args).not.toBeNull();
    expect(args).not.toMatch(ARG_BANS);
  });

  it('not vacuous: each check fails on a mutated copy of the real file', () => {
    const caption = read('services/discovery/captionService.js');
    expect(captionBans(inject(caption, "  return parts.length ? parts.join(', ')", '  if (ctx.hrBand) parts.push(`heart-rate band=${ctx.hrBand}`);\n')))
      .toEqual(['hrBand']);

    const engine = read('services/geminiEngine.js');
    expect(engineBans(inject(engine, 'module.exports = {', 'function _buildBiometricPrompt() { return "Physiological intensity band"; }\n')))
      .toEqual(['_buildBiometricPrompt', 'intensity band']);

    const handler = read('sockets/biometricHandler.js');
    const mutated = inject(handler, '            emotionTaps: state.lastEmotionTaps,', '            hrBand: bandFromHeartRate(state.stableHR),\n');
    expect(captionArgs(mutated)).toMatch(ARG_BANS);
  });
});
