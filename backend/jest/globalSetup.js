'use strict';

const { SNAPSHOT_KEY } = require('./openHandleGuard');

/**
 * W4-D06 — records the process's active resources before the first suite runs.
 *
 * Handed to `globalTeardown` through a `globalThis` slot rather than a module-level variable: both
 * hooks are loaded by jest's own transformer, and pinning the handoff to a named global makes it
 * independent of whether they end up sharing a module registry entry.
 */
module.exports = async function wave4GlobalSetup() {
  globalThis[SNAPSHOT_KEY] = process.getActiveResourcesInfo();
};
