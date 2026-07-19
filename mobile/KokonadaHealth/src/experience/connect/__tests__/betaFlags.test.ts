import { SPOTIFY_BETA_CONNECT } from '../betaFlags';

// Tripwire: the Spotify account-connect surface is HALTED for the public release under the ToS
// 5-user cap + ADR-0011 containment. The committed default MUST be false so no merged build ever
// exposes a first-connect affordance. A local tester build may flip it true; this guard trips if
// anyone commits it as true. (This is the compliance-critical committed-state invariant.)
describe('SPOTIFY_BETA_CONNECT', () => {
  it('is committed OFF (false) so the public release never exposes Spotify connect', () => {
    expect(SPOTIFY_BETA_CONNECT).toBe(false);
  });
});
