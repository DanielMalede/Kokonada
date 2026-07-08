import * as Keychain from 'react-native-keychain';
import { apiGet, apiPost, apiDelete } from '../../net/apiClient';
import { ProfileController } from './profileController';
import { wipeLocalSession } from './sessionTeardown';
import { authSession } from '../../auth/session';
import { currentUserStore } from '../../auth/currentUser';
import { clearWatchToken } from '../../health/liveHrClient';
import { warmStore } from '../../state/store';
import { player, kokoSocket } from '../playback/playbackServices';
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

async function clearLocal(): Promise<void> {
  await wipeLocalSession({
    disconnectSocket: () => kokoSocket.disconnect(),
    disposePlayer: () => player.dispose(),
    clearAuthSession: () => authSession.clear(),
    clearWatchToken: () => clearWatchToken(),
    clearLegacyToken: async () => { await Keychain.resetGenericPassword({ service: LEGACY_JWT_SERVICE }); },
    wipeColdPersistence: () => wipeColdPersistence(),
    resetWarm: () => warmStore.getState().reset(),
    resetNowPlaying: () => nowPlayingStore.getState().set({ track: null, isPlaying: false }),
    resetPlaybackError: () => playbackErrorStore.getState().clear(),
    resetLiveMode: () => liveModeStore.getState().setLiveMode(false), // persists '0' → next login is Manual
    clearCurrentUser: () => currentUserStore.getState().clear(),
  });
  playerStatusStore.getState().set('disconnected');
}

export const profileController = new ProfileController({
  apiGet, apiPost, apiDelete,
  serverLogout: () => apiPost('/api/auth/logout'),
  clearLocal,
});
