'use strict';

const { applyHealthOperations } = require('./healthSampleRepository');
const { reconcileHealthSamples } = require('./healthSampleReconciliation');
const User = require('../../models/User');

const STATUS_BY_CODE = Object.freeze({
  health_sample_identity_conflict: 409,
  health_sample_outside_retention: 422,
  health_projection_pending: 503,
  wearable_connection_changed: 409,
});

function fixedError(code, statusCode) {
  return Object.assign(new Error(code), { code, statusCode });
}

async function ingestV2Batch(userId, platform, samples, options = {}) {
  if (platform !== 'healthkit') {
    throw fixedError('health_v2_platform_not_supported', 400);
  }

  const source = 'apple_health';
  const expectedConnectionVersion = Number(options.connectionVersion ?? 0);
  const account = await User.findById(userId)
    .select('wearableProvider wearableConnectionVersion deletedAt')
    .read('primary')
    .lean();
  if (!account
    || account.deletedAt != null
    || account.wearableProvider !== source
    || Number(account.wearableConnectionVersion ?? 0) !== expectedConnectionVersion) {
    throw fixedError('wearable_connection_changed', 409);
  }
  let stored;
  try {
    stored = await applyHealthOperations(userId, source, samples, options);
    const reconciled = await reconcileHealthSamples(userId, source, {
      connectionVersion: expectedConnectionVersion,
    });
    return {
      accepted: stored.accepted,
      created: stored.created,
      replayed: stored.replayed,
      deleted: stored.deleted,
      projected: reconciled.projected,
    };
  } catch (error) {
    const statusCode = STATUS_BY_CODE[error?.code];
    if (statusCode) throw fixedError(error.code, statusCode);
    throw error;
  }
}

module.exports = { ingestV2Batch };
