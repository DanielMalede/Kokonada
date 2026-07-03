import { apiGet, apiPost, apiDelete } from '../../net/apiClient';
import { ProfileController } from './profileController';
import { wipeLocalSession } from './sessionTeardown';
import { authSession } from '../../auth/session';
import { currentUserStore } from '../../auth/currentUser';
import { clearToken } from '../../auth/tokenStore';
import { clearWatchToken } from '../../health/liveHrClient';
import { warmStore } from '../../state/store';
import { player, kokoSocket } from '../playback/playbackServices';
import { playerStatusStore } from '../player/playerStatusStore';
import { nowPlayingStore } from '../playback/nowPlayingStore';
import { playbackErrorStore } from '../playback/playbackErrorStore';
import { wipeColdPersistence } from '../../state/cold/coldPersistenceHolder';

// Prod composition: binds the injectable wipeLocalSession + ProfileController to the
// real app singletons. The teardown ORDER is the one unit-tested in sessionTeardown.

async function clearLocal(): Promise<void> {
  await wipeLocalSession({
    disconnectSocket: () => kokoSocket.disconnect(),
    disposePlayer: () => player.dispose(),
    clearAuthSession: () => authSession.clear(),
    clearWatchToken: () => clearWatchToken(),
    clearLegacyToken: () => clearToken(),
    wipeColdPersistence: () => wipeColdPersistence(),
    resetWarm: () => warmStore.getState().reset(),
    resetNowPlaying: () => nowPlayingStore.getState().set({ track: null, isPlaying: false }),
    resetPlaybackError: () => playbackErrorStore.getState().clear(),
    clearCurrentUser: () => currentUserStore.getState().clear(),
  });
  playerStatusStore.getState().set('disconnected');
}

export const profileController = new ProfileController({
  apiGet, apiPost, apiDelete,
  serverLogout: () => apiPost('/api/auth/logout'),
  clearLocal,
});
