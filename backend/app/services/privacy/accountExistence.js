'use strict';

// J2 (BE-094, DT-11 S1) — ONE definition of "the account still exists", for the jobs that act on user ids
// they did not get from a signed-in request (the nightly analysis today; the daily sweep of deleted
// accounts' data next).
//
// An account exists while a User doc carries its id. Both deletion doors remove the User doc LAST
// (authController.deleteAccount, scripts/gdpr-delete.js), so data under an id with no User doc is a
// deleted account's leftover, and a doc that is still there is an account, even one whose deletion is in
// progress or whose doc carries `deletedAt`.
//
// Read on the PRIMARY: a secondary that has not yet seen a new account would report it gone, and its data
// would be treated as a deleted account's (the HX-1 precedent, ConsentRecord.latestFor). A read error
// throws, so the caller fails closed: it never takes "could not read" for "gone".

const User = require('../../models/User');

/** The ids among `userIds` that name an existing account, as a Set of strings. Throws on a read error. */
async function existingAccountIds(userIds) {
  const ids = [...new Set((userIds || []).map(String))];
  if (!ids.length) return new Set();
  const rows = await User.find({ _id: { $in: ids } }).select('_id').read('primary').lean();
  return new Set(rows.map((row) => String(row._id)));
}

module.exports = { existingAccountIds };
