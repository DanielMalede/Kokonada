import type { ApiResult } from '../../net/apiClient';
import type { IntegrationsStatus } from '../profile/profileController';

// H2 (DT-H2-4 option P1): the boot-time Spotify connect is attempted ONLY when the server says,
// right now, that this signed-in account has Spotify linked. An unconditional connect ran
// SpotifyRemote.authorize() on NOT_LOGGED_IN — Spotify's login screen at launch for signed-out and
// never-linked users. Every failure to confirm the link fails CLOSED; the player then connects on
// first play instead (that path already exists). Never throws into the boot sequence.

export interface PlayerBootGateDeps {
  fetchIntegrations: () => Promise<ApiResult<IntegrationsStatus>>;
  connect: () => Promise<unknown>;
}

/** Resolves true only when the link was confirmed AND the connect went through. */
export async function connectPlayerIfLinked(deps: PlayerBootGateDeps): Promise<boolean> {
  try {
    const res = await deps.fetchIntegrations();
    if (!res.ok || res.data?.spotifyConnected !== true) return false;
    return (await deps.connect()) !== false;
  } catch {
    return false;
  }
}
