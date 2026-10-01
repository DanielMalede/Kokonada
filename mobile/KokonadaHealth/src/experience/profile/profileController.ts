import type { ApiResult } from '../../net/apiClient';

// Orchestrates the Profile tab's server actions. Pure + injectable so the ORDER of a
// logout teardown and the SERVER-FIRST semantics of account deletion are unit-tested.

export interface ProfileMe {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  wearableProvider?: string | null;
  entitlements?: unknown;
}

export interface IntegrationsStatus {
  musicProvider?: string | null;
  spotifyConnected?: boolean;
  youtubeConnected?: boolean;
  biometricProvider?: string | null;
  spotifyCanSave?: boolean;
}

export interface ProfileSnapshot {
  me: ProfileMe | null;
  integrations: IntegrationsStatus | null;
}

export interface ProfileControllerDeps {
  apiGet: <T>(path: string) => Promise<ApiResult<T>>;
  apiPost: <T>(path: string, body?: unknown) => Promise<ApiResult<T>>;
  apiDelete: <T>(path: string) => Promise<ApiResult<T>>;
  // Server-side session revocation (best-effort — a network failure must not block
  // the local sign-out; the local teardown still runs).
  serverLogout: () => Promise<ApiResult<unknown>>;
  // The composed local teardown (wipeLocalSession bound to the real singletons).
  clearLocal: () => Promise<void>;
  // Disconnect Spotify's local half (teardownSpotifyPlayback bound to the real singletons).
  clearSpotifyPlayback: () => Promise<void>;
  // The server reports the account linked to Spotify: lift the playback suspension Disconnect set
  // (orchestrator.resume — HX-2 B1). Optional so older compositions keep working.
  onSpotifyLinked?: () => void;
}

export class ProfileController {
  // Bumped by every successful Spotify disconnect. A status read that started before one cannot
  // resume playback after it: it describes a link that no longer exists.
  private spotifyEpoch = 0;

  constructor(private readonly deps: ProfileControllerDeps) {}

  async loadProfile(): Promise<ProfileSnapshot> {
    const epoch = this.spotifyEpoch;
    const [me, integrations] = await Promise.all([
      this.deps.apiGet<ProfileMe>('/api/auth/me'),
      this.deps.apiGet<IntegrationsStatus>('/api/integrations/status'),
    ]);
    if (integrations.ok && integrations.data?.spotifyConnected === true && epoch === this.spotifyEpoch) {
      this.deps.onSpotifyLinked?.();
    }
    return {
      me: me.ok ? me.data : null,
      integrations: integrations.ok ? integrations.data : null,
    };
  }

  // Normal sign-out: revoke server-side (best-effort), THEN wipe everything local.
  async logout(): Promise<void> {
    await this.deps.serverLogout().catch(() => undefined); // never block on the network
    await this.deps.clearLocal();
  }

  // Mint a single-use connect token for the Spotify OAuth "connect" browser
  // navigation. A top-level browser open can't carry the session JWT, so the backend
  // authenticates the /spotify/connect route via ?ct=<token>. The screen builds the
  // URL and opens it; this stays a pure, testable server call. Returns null on failure.
  async getSpotifyConnectToken(): Promise<string | null> {
    const res = await this.deps.apiPost<{ connectToken: string }>('/api/integrations/connect-token');
    return res.ok ? res.data.connectToken : null;
  }

  // Disconnect YouTube as a data source. The server clears the YouTube token, purges the
  // cached (YouTube-tainted) candidate pool, and deterministically rebuilds the profile
  // from the remaining Spotify account — so the library becomes provider-consistent and
  // natively playable. Returns the rebuild summary ({ rebuilt, provider, library }).
  async disconnectYouTube(): Promise<ApiResult<{ rebuilt: boolean; provider: string | null; library: number }>> {
    return this.deps.apiDelete('/api/integrations/youtube/disconnect');
  }

  // Disconnect Spotify (HX-2 M8) — SERVER-FIRST, like account deletion. The server stops using the
  // account and erases what was derived from it before it answers; only then does the device stop
  // playing and forget the queue.
  //
  // An error response does NOT mean "still connected": the server deletes the token BEFORE its
  // purge, so a purge that failed leaves the account already unlinked (the daily job finishes the
  // erasure). On an error the device therefore re-reads the link and follows the server: unlinked →
  // it stops Spotify too; still linked or unreadable → nothing changes here. The error is returned
  // either way, so the screen can say the disconnect did not complete.
  async disconnectSpotify(): Promise<ApiResult<{ message: string }>> {
    const res = await this.deps.apiDelete<{ message: string }>('/api/integrations/spotify/disconnect');
    if (res.ok) {
      await this.stopSpotifyOnDevice();
      return res;
    }
    const status = await this.deps.apiGet<IntegrationsStatus>('/api/integrations/status');
    if (status.ok && status.data?.spotifyConnected === false) await this.stopSpotifyOnDevice();
    return res;
  }

  private async stopSpotifyOnDevice(): Promise<void> {
    this.spotifyEpoch += 1;
    await this.deps.clearSpotifyPlayback();
  }

  // GDPR delete — SERVER-FIRST: only wipe locally once the server confirms erasure.
  // A network failure surfaces the error and leaves the session intact (the user is
  // NOT signed out on a failed delete). No separate /logout call — the account is gone.
  async deleteAccount(): Promise<ApiResult<unknown>> {
    const res = await this.deps.apiDelete('/api/auth/account');
    if (res.ok) {
      await this.deps.clearLocal();
    }
    return res;
  }
}
