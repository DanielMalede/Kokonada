'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../app-core.js');

test('normalizes stored learning preferences', () => {
  assert.equal(core.normalizeLearningPreference('on'), true);
  assert.equal(core.normalizeLearningPreference('off'), false);
  assert.equal(core.normalizeLearningPreference('ON'), null);
  assert.equal(core.normalizeLearningPreference(''), null);
  assert.equal(core.normalizeLearningPreference(null), null);
});

test('defaults Learning Mode on when a preference is missing or malformed', () => {
  assert.equal(core.resolveInitialLearningMode(() => null), true);
  assert.equal(core.resolveInitialLearningMode(() => 'unexpected'), true);
  assert.equal(core.resolveInitialLearningMode(() => 'off'), false);
});

test('defaults Learning Mode on when preference access throws', () => {
  assert.equal(
    core.resolveInitialLearningMode(() => {
      throw new Error('storage denied');
    }),
    true,
  );
});

test('recognizes equal full and short commit prefixes as current', () => {
  assert.equal(core.deriveSnapshotState('55d68cc', '55d68cc1bb42b7bb6f089582c2d9206f8548ac71'), 'current');
  assert.equal(core.deriveSnapshotState('55D68CC1BB42', '55d68cc'), 'current');
});

test('marks a different valid commit as stale', () => {
  assert.equal(core.deriveSnapshotState('55d68cc', '71b850c5651c55c77219b30785fa1124ab745935'), 'stale');
});

test('treats missing or malformed checkout commits as unknown', () => {
  assert.equal(core.deriveSnapshotState('55d68cc', null), 'unknown');
  assert.equal(core.deriveSnapshotState('55d68cc', ''), 'unknown');
  assert.equal(core.deriveSnapshotState('55d68cc', 'not-a-sha'), 'unknown');
  assert.equal(core.deriveSnapshotState('short', '55d68cc'), 'unknown');
});

test('advances through the learning path and stops safely', () => {
  const orderedIds = ['overview', 'journey', 'architecture', 'status', 'workflow'];

  assert.equal(core.nextStepId('overview', orderedIds), 'journey');
  assert.equal(core.nextStepId('status', orderedIds), 'workflow');
  assert.equal(core.nextStepId('workflow', orderedIds), null);
  assert.equal(core.nextStepId('missing', orderedIds), null);
});
