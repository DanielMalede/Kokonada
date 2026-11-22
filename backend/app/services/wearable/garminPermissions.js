'use strict';

/**
 * Garmin user permissions (BE-219), read CLOSED.
 *
 * Garmin reports what a user granted at connect (GET /wellness-api/rest/user/permissions) and, after that, in
 * the `userPermissionsChange` notification (the PKCE spec of 2025-07-23: "Post consent changes will be notified
 * via the User_Permission webhook"). The spec's example names five values and prints the body as
 * `{["ACTIVITY_EXPORT", …]}`, which is not JSON, so the reader takes exactly two shapes, a bare array or an
 * object whose `permissions` is an array, and nothing else. A value it does not know is ignored and counted. A
 * shape it cannot read is null, "unknown", never "nothing granted": only a readable list can narrow or revoke.
 *
 * The granted list lives inside the user's encrypted wearableToken blob (no new User schema path), and the ingest
 * seam (garminIngest.js) drops every summary type it does not permit.
 */

const User = require('../../models/User');

const HEALTH_EXPORT = 'HEALTH_EXPORT';

// The values the PKCE spec's example names.
const GARMIN_PERMISSIONS = Object.freeze(['ACTIVITY_EXPORT', 'COURSE_IMPORT', HEALTH_EXPORT, 'MCT_EXPORT', 'WORKOUT_IMPORT']);
const KNOWN = new Set(GARMIN_PERMISSIONS);

// The summary types this app ingests (adapter.normalizeGarminSummaries) and the permission each needs. Every
// other type is outside the permitted set whatever the user granted: it reaches no store today either.
const SUMMARY_PERMISSION = Object.freeze({
  dailies: HEALTH_EXPORT,
  sleeps: HEALTH_EXPORT,
  hrv: HEALTH_EXPORT,
  stressDetails: HEALTH_EXPORT,
  respiration: HEALTH_EXPORT,
  pulseox: HEALTH_EXPORT,
});

/** A list of permissions, closed: `{ permissions, unknown }` (known values, sorted, unique), or null when `raw` is not an array. */
function parsePermissionList(raw) {
  if (!Array.isArray(raw)) return null;
  const kept = new Set();
  let unknown = 0;
  for (const value of raw) {
    if (typeof value === 'string' && KNOWN.has(value)) kept.add(value);
    else unknown += 1;
  }
  return { permissions: [...kept].sort(), unknown };
}

/** The GET /user/permissions body: a bare array, or an object whose `permissions` is one. Anything else is null. */
function parsePermissionsResponse(data) {
  if (Array.isArray(data)) return parsePermissionList(data);
  if (data && typeof data === 'object' && Array.isArray(data.permissions)) return parsePermissionList(data.permissions);
  return null;
}

/** True only for a list that holds HEALTH_EXPORT: without it no summary this app ingests is permitted. */
function hasHealthPermission(permissions) {
  return Array.isArray(permissions) && permissions.includes(HEALTH_EXPORT);
}

/**
 * The stored record in a decrypted wearableToken blob. `undefined`: no record (no blob, or a blob written before
 * BE-219 with no `permissions` key), so nothing is narrowed. An array: the granted list, re-read closed. null: a
 * record that is not a list, so nothing is permitted (fail closed).
 */
function storedPermissions(blob) {
  if (!blob || typeof blob !== 'object' || !Object.prototype.hasOwnProperty.call(blob, 'permissions')) return undefined;
  const parsed = parsePermissionList(blob.permissions);
  return parsed ? parsed.permissions : null;
}

/** The user's stored record, read from their own User row (undefined when there is no row or no record). */
async function readStoredPermissions(userId) {
  const user = await User.findById(userId);
  if (!user || typeof user.getToken !== 'function') return undefined;
  return storedPermissions(user.getToken('wearableToken'));
}

/**
 * Narrow a push to what the user permitted. `permissions` undefined (no record): every item passes. Otherwise an
 * item passes only when its type needs a permission the list holds; a list that is not an array passes nothing.
 */
function permitSummaries(items, permissions) {
  const list = items || [];
  if (permissions === undefined) return { admitted: list, droppedNotPermitted: 0 };
  const granted = Array.isArray(permissions) ? permissions : [];
  const admitted = list.filter(({ type } = {}) => {
    const needs = Object.prototype.hasOwnProperty.call(SUMMARY_PERMISSION, type) ? SUMMARY_PERMISSION[type] : null;
    return needs !== null && granted.includes(needs);
  });
  return { admitted, droppedNotPermitted: list.length - admitted.length };
}

module.exports = Object.freeze({
  HEALTH_EXPORT,
  GARMIN_PERMISSIONS,
  SUMMARY_PERMISSION,
  parsePermissionList,
  parsePermissionsResponse,
  hasHealthPermission,
  storedPermissions,
  readStoredPermissions,
  permitSummaries,
});
