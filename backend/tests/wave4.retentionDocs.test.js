'use strict';

// W4-D13 — the standing guard for S5's FIFTH registration surface: the retention-windows
// documentation.
//
// §0.4 S5 names five places a new user-scoped collection must be registered in the SAME PR that
// introduces it. Four of them are code (account erasure, gdpr-delete, the GDPR export, per-wearable
// erasure) and are already guarded by shadow.qa4.crypto + consentPrivacyLockstep. The fifth is a
// DOCUMENT — docs/PRIVACY_DECLARATIONS.md — and a document is the one surface nobody can fail:
// W4-004 registered VitalSample in all four code surfaces and left the doc describing a
// nine-collection erasure cascade the code had outgrown. That document is store-facing (Play Data
// safety, App Store privacy) and is what compliance-auditor gates a submission on, so drift there
// is a compliance defect, not a typo.
//
// This suite makes the doc mechanically checkable against the code, following this run's precedent
// of pinning a guard with the bug that proved it was needed (W4-D01 marker, W4-D02 state-guard,
// W4-D06 open-handle, W4-D11 lint).
//
// Pure filesystem/source parsing — no Mongo, no Redis, no network.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const MODELS_DIR = path.join(__dirname, '../app/models');
const PRIVACY_DOC = path.join(REPO_ROOT, 'docs/PRIVACY_DECLARATIONS.md');
const ERASURE_SRC = path.join(__dirname, '../app/services/privacy/erasure.js');

const readDoc = () => fs.readFileSync(PRIVACY_DOC, 'utf8');

/** The `## <title>` section body, up to the next `## ` heading (or EOF). */
function section(markdown, title) {
  const start = markdown.indexOf(`## ${title}`);
  if (start === -1) return null;
  const rest = markdown.slice(start + 3);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * Every user-scoped model that self-expires via a MongoDB TTL index — i.e. every model whose
 * retention window is a PROMISE the retention table is where we make. Discovered from the
 * filesystem (never a hand-kept list), mirroring the completeness discovery in
 * shadow.qa4.crypto / consentPrivacyLockstep.
 */
function ttlIndexedUserScopedModels() {
  return fs.readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith('.js') && f !== 'encryptedField.js')
    .map((f) => ({ name: f.replace(/\.js$/, ''), src: fs.readFileSync(path.join(MODELS_DIR, f), 'utf8') }))
    .filter((m) => /userId\s*:/.test(m.src) && /expireAfterSeconds/.test(m.src));
}

/** The model identifiers `eraseUserChildData` actually deletes — parsed from the real cascade. */
function erasureCascadeModels() {
  const src = fs.readFileSync(ERASURE_SRC, 'utf8');
  const start = src.indexOf('async function eraseUserChildData');
  expect(start).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf('await purgeUserKeys', start));
  return [...body.matchAll(/(\w+)\.deleteMany\(\s*\{\s*userId\s*\}/g)].map((m) => m[1]);
}

/** The collection list the Play "Users can request data deletion" answer shows to the store. */
function playDeletionCascadeList() {
  const line = readDoc()
    .split('\n')
    .find((l) => l.includes('Users can request data deletion'));
  expect(line).toBeTruthy();
  const inParens = line.match(/hard delete across every user-owned collection \(([^)]+)\)/);
  expect(inParens).toBeTruthy();
  return inParens[1].split(',').map((s) => s.trim()).filter(Boolean);
}

describe('W4-D13 · retention documentation is registered, not remembered', () => {
  it('discovers the TTL-indexed user-scoped models from the filesystem (guard is not vacuous)', () => {
    const models = ttlIndexedUserScopedModels().map((m) => m.name);
    // A guard that discovers nothing passes forever. Pin that discovery actually works, and that
    // it sees the collection this row was written about.
    expect(models.length).toBeGreaterThanOrEqual(4);
    expect(models).toEqual(expect.arrayContaining(['BiometricLog', 'ServeEvent', 'VitalSample']));
  });

  it('names EVERY TTL-indexed user-scoped model in the Retention table', () => {
    const retention = section(readDoc(), 'Retention');
    expect(retention).toBeTruthy();
    const missing = ttlIndexedUserScopedModels()
      .map((m) => m.name)
      .filter((name) => !retention.includes(`\`${name}\``));
    // The failure message names the collection, so a future session is told what to write.
    expect(missing).toEqual([]);
  });

  it('states the retention MECHANISM (the TTL field) for every TTL-indexed model', () => {
    const retention = section(readDoc(), 'Retention');
    for (const { name, src } of ttlIndexedUserScopedModels()) {
      // The field the TTL index is declared on — that is the operative fact, not the number.
      const field = src.match(/index\(\s*\{\s*(\w+)\s*:\s*1\s*\}\s*,\s*\{\s*expireAfterSeconds/);
      expect(field).toBeTruthy();
      const row = retention.split('\n').find((l) => l.includes(`\`${name}\``));
      expect(row).toBeTruthy();
      expect(row).toContain(`\`${field[1]}\``);
    }
  });

  it('documents the env var for every TTL window that is env-tunable', () => {
    const retention = section(readDoc(), 'Retention');
    for (const { name, src } of ttlIndexedUserScopedModels()) {
      const envVar = src.match(/process\.env\.([A-Z0-9_]*RETENTION[A-Z0-9_]*)/);
      if (!envVar) continue; // a hardcoded window has nothing to document
      const row = retention.split('\n').find((l) => l.includes(`\`${name}\``));
      expect(row).toContain(envVar[1]);
    }
  });

  it('shows the store EXACTLY the collections the erasure cascade deletes (no more, no fewer)', () => {
    const declared = playDeletionCascadeList();
    const actual = erasureCascadeModels();
    // Order is editorial; membership is the compliance claim.
    expect([...declared].sort()).toEqual([...actual].sort());
  });

  it('keeps the erasure-cascade provenance comment pointing at the real function', () => {
    const doc = readDoc();
    const line = doc.split('\n').find((l) => l.includes('Users can request data deletion'));
    const cite = line.match(/erasure\.js:(\d+)-(\d+)/);
    expect(cite).toBeTruthy();
    const [, from, to] = cite.map(Number);
    const src = fs.readFileSync(ERASURE_SRC, 'utf8').split('\n');
    // The cited span must actually contain the cascade — a stale line range is a citation that
    // silently stops being evidence.
    const cited = src.slice(from - 1, to).join('\n');
    expect(cited).toContain('async function eraseUserChildData');
    for (const model of erasureCascadeModels()) {
      expect(cited).toContain(`${model}.deleteMany`);
    }
  });
});
