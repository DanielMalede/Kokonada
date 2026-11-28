import * as Keychain from 'react-native-keychain';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { apiGet, apiPost, apiDelete, type ApiResult } from '../../net/apiClient';
import { ProfileController } from './profileController';
import { createSessionTeardown, type TeardownContext } from './sessionTeardown';
import { teardownSpotifyPlayback } from './spotifyTeardown';
import { authSession } from '../../auth/session';
import { currentUserStore, getCurrentUserId } from '../../auth/currentUser';
import { GOOGLE_WEB_CLIENT_ID } from '../../health/config';
import { CONNECT_KEY_PREFIX } from '../connect/connectStore';
import { createSecureStore } from '../../storage/secureStoreFactory';
import { clearWatchToken } from '../../health/liveHrClient';
import { healthLane, stopLaneThenClearToken } from '../../health/healthLaneServices';
import { warmStore } from '../../state/store';
import { player, kokoSocket, orchestrator } from '../playback/playbackServices';
import { playerStatusStore } from '../player/playerStatusStore';
import { nowPlayingStore } from '../playback/nowPlayingStore';
import { playbackErrorStore } from '../playback/playbackErrorStore';
import { liveModeStore } from '../generate/liveModeStore';
import { wipeColdPersistence } from '../../state/cold/coldPersistenceHolder';

// Prod composition: binds the injectable wipeLocalSession + ProfileController to the
// real app singletons. The teardown ORDER is the one unit-tested in sessionTeardown.

// Keychain service of the retired pre-migration session JWT. Login no longer writes
// it, but an upgraded install may still hold a leftover entry here — purge it on
// logout so teardown leaves ZERO bytes (AuthSession.clear only wipes its own service).
const LEGACY_JWT_SERVICE = 'com.kokonadahealth.jwt';

// C9: the account's own keys on this phone, removed by prefix when the account is deleted (a logout
// and an involuntary end keep them). Each family ends with the uid and a dot, so no other account's
// keys share a prefix.
const accountKeyPrefixes = (uid: string): string[] => [`${CONNECT_KEY_PREFIX}.${uid}.`];

// C9: the Google SDK refuses signOut and revokeAccess until configure() ran in this process
// (RNGoogleSigninModule: "apiClient is null - call configure() first"), and a session restored from
// the Keychain at launch never ran the sign-in that configures it.
function googleSignIn(): typeof GoogleSignin {
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  return GoogleSignin;
}

const teardown = createSessionTeardown({
  disconnectSocket: () => kokoSocket.disconnect(),
  disposePlayer: () => player.dispose(), // pauses Spotify before App Remote is severed
  revokeProvider: async () => { await googleSignIn().revokeAccess(); },
  signOutProvider: async () => { await googleSignIn().signOut(); },
  clearAuthSession: () => authSession.clear(),
  // H2: the live-HR feed stops inside this SAME slot, before the credential it rides is wiped —
  // and so well before resetWarm, which a late reading used to refill for the next account.
  // The teardown order itself is unchanged.
  clearWatchToken: () => stopLaneThenClearToken(healthLane, clearWatchToken),
  clearLegacyToken: async () => { await Keychain.resetGenericPassword({ service: LEGACY_JWT_SERVICE }); },
  wipeColdPersistence: () => wipeColdPersistence(),
  resetWarm: () => warmStore.getState().reset(),
  resetNowPlaying: () => nowPlayingStore.getState().set({ track: null, isPlaying: false }),
  resetPlaybackError: () => playbackErrorStore.getState().clear(),
  resetLiveMode: () => liveModeStore.getState().setLiveMode(false), // persists '0' → next login is Manual
  removeAccountKeys: async (uid) => {
    const store = await createSecureStore(); // the same encrypted instance the app opened at launch
    for (const prefix of accountKeyPrefixes(uid)) store.removeByPrefix(prefix);
  },
  clearCurrentUser: () => currentUserStore.getState().clear(),
  sessionEpoch: () => authSession.sessionEpoch(),
  hasSession: () => authSession.hasSession(),
});

// C9: an account deletion the server confirmed (a 2xx), with the session and account it ended; the
// next clearLocal tears that epoch down as accountDeleted.
const ACCOUNT_PATH = '/api/auth/account';
let confirmedDeletion: { epoch: number; uid: string | null } | null = null;

async function deleteThenNote<T>(path: string): Promise<ApiResult<T>> {
  const epoch = authSession.sessionEpoch();
  const uid = getCurrentUserId();
  const res = await apiDelete<T>(path);
  if (path === ACCOUNT_PATH && res.ok) confirmedDeletion = { epoch, uid };
  return res;
}

async function clearLocal(): Promise<void> {
  const deletion = confirmedDeletion;
  confirmedDeletion = null;
  const ctx: TeardownContext = deletion
    ? { reason: 'accountDeleted', ...deletion }
    : { reason: 'loggedOut', epoch: authSession.sessionEpoch(), uid: getCurrentUserId() };
  await teardown(ctx);
  playerStatusStore.getState().set('disconnected');
}

// Disconnect Spotify's local half (HX-2 M8): the session and the socket stay — only Spotify goes.
async function clearSpotifyPlayback(): Promise<void> {
  await teardownSpotifyPlayback({
    disposePlayer: () => player.dispose(),
    clearQueue: () => orchestrator.clear(),
    resetNowPlaying: () => {
      nowPlayingStore.getState().set({ track: null, isPlaying: false });
      nowPlayingStore.getState().setCover(null);
    },
    markDisconnected: () => playerStatusStore.getState().set('disconnected'),
  });
}

export const profileController = new ProfileController({
  apiGet, apiPost, apiDelete: deleteThenNote,
  // Security L2: the held refresh token rides along, read here, before clearLocal wipes it, so the server
  // revokes its whole family (authController.js `logout`); a copied refresh token dies with the sign-out.
  serverLogout: () => {
    const refreshToken = authSession.getRefreshToken();
    return apiPost('/api/auth/logout', refreshToken ? { refreshToken } : undefined);
  },
  clearLocal,
  clearSpotifyPlayback,
  onSpotifyLinked: () => orchestrator.resume(),
});
