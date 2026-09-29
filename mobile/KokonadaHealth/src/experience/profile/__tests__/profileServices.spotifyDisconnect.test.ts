// A module, not a script: this suite only require()s at run time, and without a top-level import
// or export TypeScript would merge its helpers into the global scope of every other such suite.
export {};

// HX-2 M8 — Disconnect Spotify through the REAL prod composition: profileServices →
// ProfileController → the real apiClient → a fake backend; then teardownSpotifyPlayback against the
// REAL Now Playing and player-status stores. Only the native-heavy playback graph (App Remote
// player, socket, orchestrator) is a recorder — every suite mocks it — logging into the same event
// list as the server call, so the order is asserted on real calls: server first, then the device.

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 31 },
  PermissionsAndroid: {
    PERMISSIONS: { BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect', ACCESS_FINE_LOCATION: 'loc' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    check: jest.fn(async () => false),
    requestMultiple: jest.fn(),
  },
}));

const mockEvents: string[] = [];
jest.mock('../../playback/playbackServices', () => ({
  player: { dispose: jest.fn(async () => { mockEvents.push('player-disposed'); }) },
  kokoSocket: { disconnect: jest.fn(() => { mockEvents.push('socket-severed'); }) },
  orchestrator: { clear: jest.fn(() => { mockEvents.push('queue-cleared'); }) },
}));
jest.mock('react-native-health-connect', () => ({
  initialize: jest.fn(async () => true),
  getGrantedPermissions: jest.fn(async () => []),
  requestPermission: jest.fn(),
  readRecords: jest.fn(async () => ({ records: [] })),
}));
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => true),
  resetGenericPassword: jest.fn(async () => true),
}));

let backendStatus = 200;
function installFakeBackend(): void {
  (global as any).fetch = jest.fn(async (url: string, init: { method?: string } = {}) => {
    const method = init.method ?? 'GET';
    const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (method === 'DELETE' && path === '/api/integrations/spotify/disconnect') {
      mockEvents.push('server-disconnect');
      return json(backendStatus, backendStatus < 400 ? { message: 'Spotify disconnected' } : { error: 'failed' });
    }
    return json(404, {});
  });
}

function load() {
  jest.resetModules();
  const { profileController } = require('../profileServices');
  const { nowPlayingStore } = require('../../playback/nowPlayingStore');
  const { playerStatusStore } = require('../../player/playerStatusStore');
  const { currentUserStore } = require('../../../auth/currentUser');
  currentUserStore.getState().setUser({ id: 'account-a', displayName: 'A', email: 'a@x.io' });
  // Mid-song: a track from the generated queue is on screen with its cover, the remote is linked.
  nowPlayingStore.getState().set({
    track: { id: 'trk1', uri: 'spotify:track:trk1', title: 'Song A', artist: 'Artist A', receipt: null, recordingKey: null },
    isPlaying: true,
  });
  nowPlayingStore.getState().setCover('file:///cache/cover-trk1.jpg');
  playerStatusStore.getState().set('connected');
  return { profileController, nowPlayingStore, playerStatusStore, currentUserStore };
}

beforeEach(() => {
  backendStatus = 200;
  mockEvents.length = 0;
  installFakeBackend();
});

describe('Disconnect Spotify — the success path', () => {
  it('asks the server FIRST, then disposes the player and clears the queue', async () => {
    const w = load();

    const res = await w.profileController.disconnectSpotify();

    expect(res.ok).toBe(true);
    expect(mockEvents).toEqual(['server-disconnect', 'player-disposed', 'queue-cleared']);
  });

  it('clears Now Playing (track, playing state and cover) and the status reads disconnected', async () => {
    const w = load();

    await w.profileController.disconnectSpotify();

    expect(w.nowPlayingStore.getState()).toMatchObject({ track: null, isPlaying: false, coverUri: null });
    expect(w.playerStatusStore.getState().status).toBe('disconnected');
  });

  it('is not a logout: the socket stays up and the user stays signed in', async () => {
    const w = load();

    await w.profileController.disconnectSpotify();

    expect(mockEvents).not.toContain('socket-severed');
    expect(w.currentUserStore.getState().user?.id).toBe('account-a');
  });
});

describe('Disconnect Spotify — the failure path', () => {
  it('a server error changes nothing on the device: still playing, still connected', async () => {
    backendStatus = 500;
    const w = load();

    const res = await w.profileController.disconnectSpotify();

    expect(res.ok).toBe(false);
    expect(mockEvents).toEqual(['server-disconnect']);
    expect(w.nowPlayingStore.getState()).toMatchObject({ isPlaying: true, coverUri: 'file:///cache/cover-trk1.jpg' });
    expect(w.nowPlayingStore.getState().track?.id).toBe('trk1');
    expect(w.playerStatusStore.getState().status).toBe('connected');
  });
});
