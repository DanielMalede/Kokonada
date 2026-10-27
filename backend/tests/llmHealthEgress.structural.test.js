'use strict';

// BE-221 — the structural half of "no health information reaches Groq". llmHealthEgress.test.js
// proves the requests that the known callers send; this proves there are no others. Every Groq
// request leaves through llmCall.chatJson, reached only through geminiEngine._generate or
// llmClient.generateJson, so the call sites of those three names under backend/app ARE the egress
// surface. A new call site fails this suite until someone adds it here and, with it, a request-body
// test in llmHealthEgress.test.js.
//
// Discovery reads the real source tree, with comments stripped so a comment can neither hide a call
// nor invent one; the scanner is then run on a synthetic source to prove it is not vacuous.

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../app');
const CALLS = ['chatJson', '_generate', 'generateJson', '_callLlm'];

// file (relative to backend/app) → name → number of call sites. Definitions are not calls.
const ALLOWED = {
  'services/llmClient.js':                  { chatJson: 1 },
  'services/geminiEngine.js':               { chatJson: 1, _generate: 2, _callLlm: 1 },
  'services/discovery/captionService.js':   { generateJson: 1 },
  'services/features/llmEstimatorAdapter.js': { generateJson: 1 },
  'workers/embedding.worker.js':            { generateJson: 1 },
};

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function callSites(src) {
  const code = stripComments(src);
  const out = {};
  for (const name of CALLS) {
    const re = new RegExp(`(^|[^\\w$])(function\\s+)?${name.replace('$', '\\$')}\\s*\\(`, 'g');
    let m;
    let n = 0;
    while ((m = re.exec(code)) !== null) if (!m[2]) n += 1;
    if (n) out[name] = n;
  }
  return out;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

function scanTree() {
  const found = {};
  for (const file of walk(APP)) {
    const sites = callSites(fs.readFileSync(file, 'utf8'));
    if (Object.keys(sites).length) found[path.relative(APP, file).split(path.sep).join('/')] = sites;
  }
  return found;
}

const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');

describe('the Groq egress surface is exactly the allow-list', () => {
  it('every call site of chatJson, _generate, generateJson and _callLlm under backend/app is pinned', () => {
    expect(scanTree()).toEqual(ALLOWED);
  });

  it('the scanner is not vacuous: an added call site, a renamed client or a comment are each told apart', () => {
    const base = 'async function generateJson(p) { return chatJson({ prompt: p }); }\n';
    expect(callSites(base)).toEqual({ chatJson: 1 });
    expect(callSites(`${base}const r = await llmClient.generateJson(prompt);\n`)).toEqual({ chatJson: 1, generateJson: 1 });
    expect(callSites(`${base}// llmClient.generateJson(prompt)\n/* _generate(x) */\n`)).toEqual({ chatJson: 1 });
    expect(callSites('const x = my_generate(1); const y = _generateMore(2);')).toEqual({});
  });

  it('a synthetic tree with an extra caller would fail the pin', () => {
    const tree = { ...ALLOWED, 'services/newThing.js': callSites('await llmClient.generateJson(prompt);') };
    expect(tree).not.toEqual(ALLOWED);
  });
});

describe('the health-derived inputs are gone from the prompt builders', () => {
  it('captionService.js names no heart-rate band, no tempo target and no bio: key', () => {
    const src = read('services/discovery/captionService.js');
    expect(src).not.toMatch(/hrBand/);
    expect(src).not.toMatch(/bpmCenter/);
    expect(src).not.toMatch(/bio:/);
  });

  it('geminiEngine.js no longer defines the biometric prompt or its band resolver', () => {
    const src = stripComments(read('services/geminiEngine.js'));
    expect(src).not.toMatch(/_buildBiometricPrompt/);
    expect(src).not.toMatch(/_resolveHrBand/);
    expect(src).not.toMatch(/intensity band/i);
  });

  it('the handler hands the caption service no band, no targets and no watch activity', () => {
    const src = stripComments(read('sockets/biometricHandler.js'));
    const at = src.indexOf('captionService.captionDiscovery(');
    expect(at).toBeGreaterThan(-1);
    const args = src.slice(at, src.indexOf('});', at) + 3);
    expect(args).not.toMatch(/hrBand|targets|latestActivity|stableHR/);
  });

  it('the checks above are not vacuous: the sources they guard regress visibly', () => {
    expect('if (ctx.hrBand) parts.push(x);').toMatch(/hrBand/);
    const regressed = "captionService.captionDiscovery(t, { moodKey, hrBand: bandFromHeartRate(state.stableHR) });";
    expect(regressed.slice(0, regressed.indexOf('});') + 3)).toMatch(/hrBand|targets|latestActivity|stableHR/);
  });
});
