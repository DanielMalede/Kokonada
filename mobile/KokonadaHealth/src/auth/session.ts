import * as Keychain from 'react-native-keychain';
import { AuthSession, type RefreshOutcome, type TokenPair } from './authSession';
import { BACKEND_URL } from '../health/config';

// The single authoritative token plane for the whole app. Both the socket client
// (synchronous getAccessToken) and the REST apiClient read from this one AuthSession,
// and the login flow installs the rotating {access,refresh} pair into it. Extracted
// into its own module (no native player/socket imports) so the login flow can populate
// it without dragging the playback graph in. (QA4 Suspect #1 fix.)

const SESSION_SERVICE = 'com.kokonadahealth.session';

// SA309-2: react-native-keychain 10 runs setGenericPassword in a coroutine on Dispatchers.Default under
// a mutex and resetGenericPassword at once, without it (android KeychainModule.kt), so a reset issued
// after a save could complete before that save's write. Every Keychain call here runs on ONE chain, in
// the order it was issued: a sign-out after a rotation leaves nothing on disk, and a sign-in after that
// leaves its own pair. A failed call never blocks the next.
let keychainQueue: Promise<unknown> = Promise.resolve();
function inIssueOrder<T>(op: () => Promise<T>): Promise<T> {
  const run = keychainQueue.then(op, op);
  keychainQueue = run.then(() => undefined, () => undefined);
  return run;
}

export const keychainSession = {
  loadTokens: (): Promise<TokenPair | null> => inIssueOrder(async () => {
    const creds = await Keychain.getGenericPassword({ service: SESSION_SERVICE });
    if (!creds || !creds.password) return null;
    try { return JSON.parse(creds.password) as TokenPair; } catch { return null; }
  }),
  saveTokens: (t: TokenPair): Promise<void> => inIssueOrder(async () => {
    await Keychain.setGenericPassword('session', JSON.stringify(t), { service: SESSION_SERVICE });
  }),
  clearTokens: (): Promise<void> => inIssueOrder(async () => { await Keychain.resetGenericPassword({ service: SESSION_SERVICE }); }),
  // C1: only the server's dead-family answer (401, authController.js `refresh`) is `dead`. A thrown
  // fetch (offline, timed out, aborted), a 5xx, a 429 from the auth limiter, any other status or an
  // unreadable 200 is `unavailable`: no verdict on the family, so the session must survive it.
  refreshEndpoint: async (refreshToken: string): Promise<RefreshOutcome> => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (res.status === 401) return { kind: 'dead' };
      if (!res.ok) return { kind: 'unavailable' };
      const { token, refreshToken: nextRefresh } = await res.json();
      if (typeof token !== 'string' || !token || typeof nextRefresh !== 'string' || !nextRefresh) {
        return { kind: 'unavailable' };
      }
      return { kind: 'ok', tokens: { access: token, refresh: nextRefresh } };
    } catch {
      return { kind: 'unavailable' };
    }
  },
};

export const authSession = new AuthSession(keychainSession);
