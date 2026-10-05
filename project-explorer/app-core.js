(function initKokonadaExplorerCore(root, factory) {
  'use strict';

  const core = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = core;
  }

  if (root) {
    root.KokonadaExplorerCore = core;
  }
})(typeof window !== 'undefined' ? window : null, function createExplorerCore() {
  'use strict';

  const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

  function normalizeLearningPreference(raw) {
    if (raw === 'on') {
      return true;
    }

    if (raw === 'off') {
      return false;
    }

    return null;
  }

  function resolveInitialLearningMode(readPreference) {
    try {
      const normalized = normalizeLearningPreference(readPreference());
      return normalized === null ? true : normalized;
    } catch (_error) {
      return true;
    }
  }

  function deriveSnapshotState(snapshotCommit, currentCommit) {
    if (!SHA_PATTERN.test(snapshotCommit || '') || !SHA_PATTERN.test(currentCommit || '')) {
      return 'unknown';
    }

    const snapshot = snapshotCommit.toLowerCase();
    const current = currentCommit.toLowerCase();
    return snapshot.startsWith(current) || current.startsWith(snapshot) ? 'current' : 'stale';
  }

  function nextStepId(currentId, orderedIds) {
    if (!Array.isArray(orderedIds)) {
      return null;
    }

    const index = orderedIds.indexOf(currentId);
    if (index < 0 || index >= orderedIds.length - 1) {
      return null;
    }

    return orderedIds[index + 1];
  }

  return Object.freeze({
    normalizeLearningPreference,
    resolveInitialLearningMode,
    deriveSnapshotState,
    nextStepId,
  });
});
