'use strict';

// TEMP ops driver (delete after use): rebuild a user's MusicProfile against PROD so the new
// SOURCE_WEIGHTS.playlist=4 re-weights affinity. buildProfile OVERWRITES the library, so this is
// GUARDED: refresh the Spotify token, PRE-FLIGHT verify it returns data, snapshot the current
// profile, rebuild, and AUTO-RESTORE if the library regresses (never wipe the 1508-track library).
// Run from backend/ via:  railway run -p <proj> -e production -s kokonada-backend -- node _rebuildDriver.js

const mongoose = require('mongoose');
const User = require('./app/models/User');
const MusicProfile = require('./app/models/MusicProfile');
const spotify = require('./app/services/spotify');
const { buildProfile } = require('./app/services/musicProfileService');

const USER_ID = process.env.HYDRATE_USER_ID || '6a49667538fa6fee5375ca6f';
const REGRESS_FLOOR = 0.6; // abort/restore if the rebuilt library is < 60% of the current one

const topN = (lib, n = 8) => (lib || []).slice().sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0))
  .slice(0, n).map(t => `${(t.affinity ?? 0).toFixed(1)}  ${t.artist ?? '?'} — ${t.name ?? '?'}`);

(async () => {
  if (!process.env.MONGO_URI) { console.error('NO MONGO_URI'); process.exit(2); }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('[rebuild] mongo connected');

  const before = await MusicProfile.findOne({ userId: USER_ID }).lean();
  const beforeLib = before?.library ?? [];
  console.log(`[rebuild] BEFORE library=${beforeLib.length}`);
  console.log('[rebuild] BEFORE top-affinity:\n  ' + topN(beforeLib).join('\n  '));

  const user = await User.findById(USER_ID);
  if (!user) { console.error('[rebuild] user not found'); process.exit(3); }

  // 1) Refresh the Spotify access token (auto-refreshes within 5 min of expiry, mutates user).
  let accessToken;
  try {
    accessToken = await spotify.getValidToken(user);
    await user.save(); // persist the refreshed token
    console.log('[rebuild] spotify token refreshed + saved');
  } catch (e) {
    console.error('[rebuild] token refresh FAILED — reconnect Spotify in-app instead:', e.message);
    process.exit(4);
  }

  // 2) PRE-FLIGHT: a working token must return listening data. If it does not, ABORT before
  //    buildProfile can overwrite the library with an empty analysis.
  let preflight = [];
  try { preflight = await spotify.getTopTracks(accessToken, 'short_term', 5); } catch (e) {
    console.error('[rebuild] preflight top-tracks fetch threw:', e.message);
  }
  if (!preflight || preflight.length === 0) {
    console.error(`[rebuild] PRE-FLIGHT EMPTY (top tracks=${preflight?.length ?? 0}) — token/scope issue. ABORTING, no changes made. Reconnect Spotify in-app.`);
    process.exit(5);
  }
  console.log(`[rebuild] preflight OK — ${preflight.length} top tracks returned`);

  // 3) Rebuild.
  const t0 = Date.now();
  await buildProfile(USER_ID, user, (pct, label) => console.log(`[rebuild]   ${pct}% ${label}`));
  console.log(`[rebuild] buildProfile done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // 4) Verify — auto-restore on regression.
  const after = await MusicProfile.findOne({ userId: USER_ID }).lean();
  const afterLib = after?.library ?? [];
  console.log(`[rebuild] AFTER library=${afterLib.length}`);

  if (afterLib.length < beforeLib.length * REGRESS_FLOOR) {
    console.error(`[rebuild] REGRESSION: ${afterLib.length} < ${beforeLib.length}*${REGRESS_FLOOR}. RESTORING previous library.`);
    await MusicProfile.updateOne({ userId: USER_ID }, {
      $set: {
        library: beforeLib,
        topGenres: before.topGenres, topArtists: before.topArtists,
        genreSet: before.genreSet, knownArtistIds: before.knownArtistIds,
        lastAnalyzed: new Date(),
      },
    });
    console.error('[rebuild] restored. Investigate before retrying.');
    await mongoose.connection.close();
    process.exit(6);
  }

  console.log('[rebuild] AFTER top-affinity:\n  ' + topN(afterLib).join('\n  '));
  console.log(`[rebuild] SUCCESS: library ${beforeLib.length} -> ${afterLib.length}, playlist reweight applied.`);
  await mongoose.connection.close();
  process.exit(0);
})().catch(async (e) => {
  console.error('[rebuild] FATAL', e.message);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
