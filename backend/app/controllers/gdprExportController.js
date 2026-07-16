'use strict';

// GDPR data-export endpoint (Art. 15 access / Art. 20 portability) — T3.4. Returns the
// authenticated caller's OWN data as a downloadable JSON document (decrypted where they are the
// subject; credential secrets redacted — see services/privacy/userDataExport.js). Scoped
// strictly to req.user._id, so it can never surface another user's records.

const { exportUserData } = require('../services/privacy/userDataExport');

// GET /api/auth/account/export  (auth required)
exports.exportAccountData = async (req, res, next) => {
  try {
    const data = await exportUserData(req.user._id);
    res.setHeader('Content-Disposition', 'attachment; filename="kokonada-data-export.json"');
    res.json(data);
  } catch (err) { next(err); }
};
