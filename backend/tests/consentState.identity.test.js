'use strict';

// J2 round 1 (M1, the architect's split): H3a's single definition of a current grant, and the consent read the
// state-recompute job's fence uses, live in one import-light module (services/privacy/consentState.js, which
// requires only the ConsentRecord model), so the job no longer loads the withdrawal erasure (and with it
// ServeEvent) through the consent service. The other modules re-export those definitions as the SAME objects:
// one definition each, never a copy that could drift.
//
// Pure: identities and source scanning (espree, comments are not tokens). No database.

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const espree = require('espree');

const APP = path.join(__dirname, '../app');
const consentState = require('../app/services/privacy/consentState');
const consent = require('../app/services/privacy/consent');
const gate = require('../app/services/privacy/healthConsentGate');
const fenceModule = require('../app/services/privacy/healthWriteFence');

const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return files(full);
  return e.name.endsWith('.js') ? [full] : [];
});
const rel = (f) => path.relative(APP, f).split(path.sep).join('/');
const SOURCES = files(APP).map((f) => ({ file: rel(f), tokens: espree.tokenize(fs.readFileSync(f, 'utf8'), { ecmaVersion: 'latest' }) }));

/** The files that DEFINE `name`: `function <name>(` or `const <name> =`, by tokens. */
function definers(name) {
  return SOURCES.filter(({ tokens }) => tokens.some((t, i) => t.type === 'Identifier' && t.value === name
    && ((tokens[i - 1]?.value === 'function') || (tokens[i - 1]?.value === 'const' && tokens[i + 1]?.value === '=')))).map((s) => s.file);
}
function relativeRequires(file) {
  const tokens = SOURCES.find((s) => s.file === file).tokens;
  return tokens.filter((t, i) => t.type === 'String' && tokens[i - 2]?.value === 'require' && tokens[i - 1]?.value === '(')
    .map((t) => t.value.slice(1, -1)).filter((spec) => spec.startsWith('.'));
}

describe('one definition each, in consentState.js', () => {
  it.each([
    ['statusOf'], ['getConsentState'], ['getConsentStatus'], ['isCurrentGrant'], ['verdictOf'],
    ['CURRENT_CONSENT_VERSION'], ['HEALTH_CONSENT_PURPOSE'],
  ])('%s is defined exactly once in app/, in consentState.js', (name) => {
    expect(definers(name)).toEqual(['services/privacy/consentState.js']);
  });

  it('healthWriteFence is defined exactly once in app/, in healthWriteFence.js', () => {
    expect(definers('healthWriteFence')).toEqual(['services/privacy/healthWriteFence.js']);
  });
});

describe('the other modules re-export the same objects', () => {
  it('consent.js: the status read and the constants are consentState\'s own', () => {
    expect(consent.getConsentStatus).toBe(consentState.getConsentStatus);
    expect(consent.getConsentState).toBe(consentState.getConsentState);
    expect(consent.CURRENT_CONSENT_VERSION).toBe(consentState.CURRENT_CONSENT_VERSION);
    expect(consent.HEALTH_CONSENT_PURPOSE).toBe(consentState.HEALTH_CONSENT_PURPOSE);
  });

  it('healthConsentGate.js: isCurrentGrant and healthWriteFence are the same functions', () => {
    expect(gate.isCurrentGrant).toBe(consentState.isCurrentGrant);
    expect(gate.healthWriteFence).toBe(fenceModule.healthWriteFence);
  });
});

describe('the two new modules stay import-light', () => {
  it('consentState.js requires only the ConsentRecord model', () => {
    expect(relativeRequires('services/privacy/consentState.js')).toEqual(['../../models/ConsentRecord']);
  });

  it('healthWriteFence.js requires only consentState and the User model', () => {
    expect(relativeRequires('services/privacy/healthWriteFence.js').sort()).toEqual(['../../models/User', './consentState']);
  });

  it('the state-recompute worker takes the fence from its own module, not the gate', () => {
    expect(relativeRequires('workers/stateVector.worker.js')).toContain('../services/privacy/healthWriteFence');
    expect(relativeRequires('workers/stateVector.worker.js')).not.toContain('../services/privacy/healthConsentGate');
  });
});
