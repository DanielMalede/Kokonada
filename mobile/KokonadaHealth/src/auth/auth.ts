import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { BACKEND_URL, GOOGLE_WEB_CLIENT_ID } from '../health/config';
import { authSession } from './session';

export interface KokonadaUser {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  wearableProvider?: string | null;
}

let configured = false;
function ensureConfigured() {
  if (configured) return;
  // webClientId MUST be the OAuth 2.0 *Web* client ID — it is the audience the
  // backend verifies in POST /api/auth/google (must equal backend GOOGLE_CLIENT_ID).
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  configured = true;
}

// Google Sign-In → backend exchange → store JWT. Mirrors the web app's
// `POST /api/auth/google { idToken }` → `{ token, user }` contract.
export async function signInWithGoogle(): Promise<KokonadaUser> {
  ensureConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const result: any = await GoogleSignin.signIn();
  // Return shape changed across versions: v13+ → { type:'success', data:{ idToken } },
  // older → { idToken }. Support both.
  const idToken: string | undefined = result?.data?.idToken ?? result?.idToken;
  if (!idToken) throw new Error('Google sign-in returned no idToken');

  // client:'mobile' makes the backend issue a short-lived access token PLUS a
  // rotating refresh token (handleSso → tokenService.issueSession). Without it the
  // backend falls back to the legacy 7-day cookie token and returns no refresh,
  // leaving AuthSession empty and the socket unauthenticated. (QA4 Suspect #1)
  const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, platform: 'android', client: 'mobile' }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Auth failed (${res.status})`);
  }

  const { token, refreshToken, user } = await res.json();
  // Install into the single AuthSession token plane — the socket (sync getAccessToken)
  // and the REST apiClient both read from it. client:'mobile' normally returns a
  // rotating pair; defensively, if the backend ever returns an access token WITHOUT a
  // refresh (rollback/misconfig), still install it so the session isn't left silently
  // empty — it authenticates until expiry, then a 401 triggers a clean re-login rather
  // than a broken no-auth state. Since the legacy tokenStore fallback was removed, this
  // guard is the only thing between "no refresh" and "no session". (QA4 Squad 2)
  if (token) {
    await authSession.setSession({ access: token, refresh: refreshToken ?? '' });
  }
  return user as KokonadaUser;
}

export async function isLoggedIn(): Promise<boolean> {
  // Hydrate the in-memory token plane from the Keychain and report whether a session
  // exists. bootstrap() is the same session check the prod ignition uses.
  return authSession.bootstrap();
}

export async function signOut(): Promise<void> {
  try { await GoogleSignin.signOut(); } catch { /* ignore */ }
  await authSession.clear();
}
