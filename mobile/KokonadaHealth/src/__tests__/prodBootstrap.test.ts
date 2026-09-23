// H2 — the production ignition (prodBootstrap) against a FAKE BACKEND, not mocked internals.
//
// What runs for real: AuthSession (tokens from the jest Keychain fake), the shared apiClient, the
// consent client and every store. What is replaced: the native-heavy playback graph (a recording
// player + socket), the encrypted-store factory (native MMKV), and the Health Connect sync (a
// recorder). The backend is a stateful fake `fetch` that answers by path and logs every request,
// so the assertions are about what actually leaves the device.

jest.mock('../experience/playback/playbackServices', () => ({
  player: { connect: jest.fn(async () => true) },
  playbackSocket: { ensureConnected: jest.fn() },
}));
jest.mock('../storage/secureStoreFactory', () => ({
  createSecureStore: jest.fn(async () => { throw new Error('no native MMKV in jest'); }),
}));
jest.mock('../health/healthSync', () => ({
  syncMedicalProfile: jest.fn(async () => ({ synced: false, reason: 'no-permission' })),
}));

interface FakeBackend {
  spotifyConnected: boolean;
  requests: Array<{ method: string; path: string }>;
}

let backend: FakeBackend;

function installFakeBackend(): void {
  backend = { spotifyConnected: false, requests: [] };
  (global as any).fetch = jest.fn(async (url: string, init: { method?: string } = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    backend.requests.push({ method: init.method ?? 'GET', path });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
    if (path === '/api/auth/me') return json(200, { id: 'u1', displayName: 'Dan', email: 'd@x.io' });
    if (path === '/api/integrations/status') return json(200, { spotifyConnected: backend.spotifyConnected });
    return json(404, { error: 'not found' });
  });
}

const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const hits = (path: string) => backend.requests.filter((r) => r.path.split('?')[0] === path).length;

// Fresh module graph per test: prodBootstrap holds singletons (session, current user, stores).
function load(opts: { signedIn: boolean }) {
  jest.resetModules();
  const Keychain = require('react-native-keychain');
  Keychain.getGenericPassword.mockImplementation(async ({ service }: { service: string }) =>
    opts.signedIn && service === 'com.kokonadahealth.session'
      ? { password: JSON.stringify({ access: 'access-1', refresh: 'refresh-1' }) }
      : false);
  const prod = require('../prodBootstrap');
  const { player } = require('../experience/playback/playbackServices');
  return { prod, player };
}

beforeEach(() => {
  installFakeBackend();
});

describe('prodBootstrap — the Spotify player at boot (H2)', () => {
  it('signed-out boot: no Spotify connect and no integrations read', async () => {
    const { prod, player } = load({ signedIn: false });
    backend.spotifyConnected = true; // even a linked account on the server must not matter
    await prod.startApp();
    await settle();
    expect(player.connect).not.toHaveBeenCalled();
    expect(hits('/api/integrations/status')).toBe(0);
  });

  it('signed-in boot with Spotify linked on the server: connects exactly once', async () => {
    const { prod, player } = load({ signedIn: true });
    backend.spotifyConnected = true;
    await prod.startApp();
    await settle();
    expect(hits('/api/integrations/status')).toBe(1);
    expect(player.connect).toHaveBeenCalledTimes(1);
  });

  it('signed-in boot, Spotify NOT linked: never connects (no login screen at launch)', async () => {
    const { prod, player } = load({ signedIn: true });
    backend.spotifyConnected = false;
    await prod.startApp();
    await settle();
    expect(player.connect).not.toHaveBeenCalled();
  });

  it('onSignedIn never connects the player', async () => {
    const { prod, player } = load({ signedIn: true });
    backend.spotifyConnected = true;
    await prod.onSignedIn();
    await settle();
    expect(player.connect).not.toHaveBeenCalled();
  });
});
