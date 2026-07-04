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
}

export class ProfileController {
  constructor(private readonly deps: ProfileControllerDeps) {}

  async loadProfile(): Promise<ProfileSnapshot> {
    const [me, integrations] = await Promise.all([
      this.deps.apiGet<ProfileMe>('/api/auth/me'),
      this.deps.apiGet<IntegrationsStatus>('/api/integrations/status'),
    ]);
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
