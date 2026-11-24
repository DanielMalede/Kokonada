// PR #309 review (shadow): the app has ONE KokonadaSocket for every account that signs in on the
// phone. A sign-out is its disconnect() (profileServices' teardown), and the next sign-in is the
// next ensureOpen() on the new account's access token (onSignedIn). Nothing account A left on that
// socket may reach account B: not a refresh A was waiting on, not a request A sent. The server is
// the QA-045 fake (src/testing/socket.ts), which refuses an expired token the way the backend does.

import { KokonadaSocket, type KokonadaSocketDeps } from '../net/socketClient';
import { FakeSocketServer } from '../testing/socket';

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

const settle = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

function appSocket(server: FakeSocketServer, over: Partial<KokonadaSocketDeps> = {}) {
  const account = { token: 'tok-a' as string | null };
  const onPlaylist = jest.fn();
  const onLoggedOut = jest.fn();
  const deps: KokonadaSocketDeps = {
    createSocket: server.createSocket,
    getAccessToken: () => account.token,
    refreshToken: async () => null,
    isSessionActive: () => account.token !== null,
    getEmotionIntent: () => ({ taps: [], textPrompt: '', activity: null }),
    onPlaylist,
    onLoggedOut,
    ...over,
  };
  return { sock: new KokonadaSocket(deps), account, onPlaylist, onLoggedOut };
}

describe('the app socket across a sign-out and a sign-in as another account', () => {
  // ARCH-309-1 = RA-1 (S2): disconnect() kept the recovery run, so ensureOpen() went on trusting it.
  it('A signs out while the socket waits on A\'s refresh: B\'s ensureOpen() opens B\'s socket, and A\'s late answer neither reopens nor logs out', async () => {
    const server = new FakeSocketServer({ validTokens: ['tok-a', 'tok-b'] });
    let release!: (fresh: string | null) => void;
    const refreshToken = jest.fn(() => new Promise<string | null>((r) => { release = r; }));
    const { sock, account, onLoggedOut } = appSocket(server, { refreshToken });
    sock.connect();
    server.flush();
    server.expire('tok-a');
    sock.requestPlaylist(); // the server refuses the expired token: auth_expired, then A's refresh
    await settle();
    expect(refreshToken).toHaveBeenCalledTimes(1);

    sock.disconnect(); // A signs out mid-refresh
    account.token = 'tok-b'; // B signs in
    sock.ensureOpen();
    server.flush();
    expect(server.sockets.map((s) => s.token)).toEqual(['tok-a', 'tok-b']);
    expect(server.handshakes[server.handshakes.length - 1]).toMatchObject({ token: 'tok-b', accepted: true });

    release('tok-a-2'); // A's refresh answers late
    await settle();
    server.flush();
    expect(server.sockets).toHaveLength(2);
    expect(onLoggedOut).not.toHaveBeenCalled();
    expect(() => server.assertNoLiveListeners({ except: [server.sockets[1]] })).not.toThrow();
  });
});
