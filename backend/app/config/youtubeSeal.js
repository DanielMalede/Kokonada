'use strict';

// DEC-122: YouTube connect is sealed in code. YOUTUBE_CONNECT_ENABLED may become true only through a
// reviewed PR that first ships ARCH-012's prerequisites (revoke on disconnect and on account deletion,
// deletion within 7 days, a hosted privacy policy meeting YouTube Developer Policies III.A.1 and III.A.2,
// sensitive-scope verification, BE-060, BE-056), with a signed reversal.
// DEC-040: YOUTUBE_EGRESS_ENABLED must stay false. Spotify Developer Policy III.5 forbids the
// YouTube-to-Spotify translation in every state, and YouTube Developer Policies III.E.3.b forbid passing a
// user's YouTube data to anyone the user has not expressly approved. The path is deleted at P3.
//
// Two literals, frozen, and nothing else: this module reads no environment and computes nothing, so
// no deploy setting can change either value. Pinned by tests/youtubeSeal.test.js; the structural
// guards in tests/youtubeSealOverride.structural.test.js keep any other file from shadowing them.

module.exports = Object.freeze({
  YOUTUBE_CONNECT_ENABLED: false,
  YOUTUBE_EGRESS_ENABLED: false,
});
