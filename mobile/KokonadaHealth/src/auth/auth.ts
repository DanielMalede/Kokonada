import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { BACKEND_URL, GOOGLE_WEB_CLIENT_ID } from '../health/config';
import { saveToken, getToken, clearToken } from './tokenStore';

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

  const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, platform: 'android' }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Auth failed (${res.status})`);
  }

  const { token, user } = await res.json();
  await saveToken(token);
  return user as KokonadaUser;
}

export async function isLoggedIn(): Promise<boolean> {
  return (await getToken()) !== null;
}

export async function signOut(): Promise<void> {
  try { await GoogleSignin.signOut(); } catch { /* ignore */ }
  await clearToken();
}
