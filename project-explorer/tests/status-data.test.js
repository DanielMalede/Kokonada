'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const status = require('../status-data.js');

test('exports the 2026-10-05 snapshot identity', () => {
  assert.equal(status.schemaVersion, 1);
  assert.equal(status.snapshot.commit, '55d68cc');
  assert.equal(status.snapshot.capturedOn, '2026-10-05');
  assert.equal(status.snapshot.timezone, 'Asia/Jerusalem');
});

test('pins verified backend and mobile evidence', () => {
  assert.deepEqual(status.verification.backend, {
    suitesPassed: 285,
    testsPassed: 4658,
    suitesSkipped: 3,
    testsSkipped: 38,
    todos: 1,
    provenance: 'verified-locally',
  });
  assert.deepEqual(status.verification.mobile, {
    suitesPassed: 200,
    testsPassed: 2689,
    testsSkipped: 1,
    openHandleWarning: true,
    provenance: 'verified-locally',
  });
});

test('keeps warnings and audit findings visible', () => {
  assert.deepEqual(status.verification.lint, {
    backend: { errors: 0, warnings: 21 },
    mobile: { errors: 72, warnings: 75 },
  });
  assert.deepEqual(status.verification.audit, {
    backend: { total: 6, high: 4, moderate: 2, critical: 0 },
    mobile: { total: 53, high: 40, moderate: 13, critical: 0 },
  });
});

test('keeps the deployment decision explicit', () => {
  assert.equal(status.deployment.recommendedBaseline, '55d68cc');
  assert.equal(status.deployment.reviewedPullRequest, 217);
  assert.equal(status.deployment.decision, 'hold');
  assert.equal(status.deployment.deployWithPr, false);
});

test('contains the required plain-language glossary terms', () => {
  const expectedTerms = [
    'POC',
    'Frontend',
    'Backend',
    'Runtime agent',
    'MongoDB',
    'Redis',
    'BullMQ',
    'PR',
    'CI',
    'Worktree',
    'Deploy',
    'Production verification',
  ];

  assert.deepEqual(Object.keys(status.glossary), expectedTerms);
  for (const term of expectedTerms) {
    assert.equal(typeof status.glossary[term], 'string');
    assert.ok(status.glossary[term].length > 20, `${term} needs a plain-language definition`);
  }
});
