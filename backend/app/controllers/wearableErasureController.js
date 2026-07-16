'use strict';

// Per-provider wearable erasure endpoint (T3.2). A NEW controller by ownership ruling —
// integrationsController.js is owned by Waves 1/2. Distinct from a plain disconnect: this
// clears the provider credential AND purges that provider's biometric/medical footprint
// (GDPR-grade single-wearable erasure). Folding this into the existing disconnect handlers
// is deferred to the post-Wave-1 rebase.

const { WEARABLE_PROVIDERS, eraseWearableProvider } = require('../services/privacy/wearableErasure');

// DELETE /api/integrations/wearable/:provider  (auth required)
exports.deleteWearableProvider = async (req, res, next) => {
  try {
    const { provider } = req.params;
    if (!WEARABLE_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: 'unknown wearable provider' });
    }
    const purged = await eraseWearableProvider(req.user, provider);
    res.json({ message: `${provider} disconnected and data erased`, provider, purged });
  } catch (err) { next(err); }
};
