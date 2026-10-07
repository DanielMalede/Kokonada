/// <reference types="node" />
import * as path from 'path';
import { KokonadaSocket, type KokonadaSocketDeps } from '../../net/socketClient';
import { FakeSocketServer, permutation } from '../socket';
import { loadMutant } from '../mutant';
import { APP_ROOT } from '../guards/productionImports';

// QA-045 (socket half): one shared socket fake with live listener counts that scripts stale-token
// refusal, drop, reconnect and out-of-order delivery. It models socket.io-client 4.8.3 and the
// backend's socket auth where these behaviours come from:
//   · a handshake the server middleware refuses (backend/app/sockets/index.js:42-71) is a
//     connect_error 'unauthorized' and the socket is destroyed: no auto-reconnect (socket.js:520-527);
//   · a packet after the token's expiry gets 'auth_expired' and a server disconnect (index.js:93-99),
//     which does not reconnect either ('io server disconnect');
//   · a transport drop reconnects with the same auth; packets emitted while disconnected are
//     buffered and flushed on connect BEFORE the 'connect' handlers run (socket.js:281, 610-632).
// Pass rule: a planted unsubscribe removal fails; scripted out-of-order delivery reproduces
// deterministically. The client under test is the real KokonadaSocket.

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

function client(server: FakeSocketServer, over: Partial<KokonadaSocketDeps> & { token?: string; fresh?: string | null } = {}) {
  const onPlaylist = jest.fn();
  const states: string[] = [];
  const deps: KokonadaSocketDeps = {
    createSocket: server.createSocket,
    getAccessToken: () => over.token ?? 'tok-a',
    refreshToken: async () => (over.fresh === undefined ? 'tok-b' : over.fresh),
    getEmotionIntent: () => ({ taps: [{ x: 0.1, y: 0.2 }], textPrompt: '', activity: null }),
    onPlaylist,
    onLoggedOut: jest.fn(),
    onConnectionChange: (s) => states.push(s),
    ...over,
  };
  return { sock: new KokonadaSocket(deps), onPlaylist, states, deps };
}
const settle = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

describe('QA-045 · the socket fake under the real KokonadaSocket', () => {
  it('a stale token is refused at the handshake: connect_error, no auto-retry', () => {
    const server = new FakeSocketServer({ validTokens: [] });
    const { sock, states } = client(server, { token: 'stale' });
    sock.connect();
    server.flush();
    expect(states).toEqual(['connecting', 'disconnected']);
    expect(server.handshakes.map((h) => [h.token, h.accepted])).toEqual([['stale', false]]);
    server.flush();
    expect(server.handshakes).toHaveLength(1); // destroyed by the refusal: socket.io does not retry it
  });

  it('a token that expires mid-session: auth_expired, refresh, a NEW socket, the pending request re-sent there', async () => {
    const server = new FakeSocketServer({ validTokens: ['tok-a', 'tok-b'] });
    const { sock } = client(server);
    sock.connect();
    server.flush();
    server.expire('tok-a');
    const reqId = sock.requestPlaylist();
    expect(server.refused.map((p) => p.event)).toEqual(['emotion_update']); // swallowed, never reached a handler
    await settle();
    server.flush();
    expect(server.sockets).toHaveLength(2);
    expect(server.sockets[1].token).toBe('tok-b');
    expect(server.receivedOn('request_playlist', server.sockets[1])).toEqual([{ reqId }]);
    expect(server.liveListeners(server.sockets[0])).toBe(0); // the dead socket was torn down
  });

  it('planted: KokonadaSocket with one off() removed from teardown (in memory) leaves the dead socket listening, and the check fails', async () => {
    const { KokonadaSocket: Mutant } = loadMutant<typeof import('../../net/socketClient')>(
      path.join(APP_ROOT, 'src/net/socketClient.ts'),
      [{ find: "s.off('playlist_ready', this.handlePlaylist);", replace: '' }],
      require,
    );
    const server = new FakeSocketServer({ validTokens: ['tok-a', 'tok-b'] });
    const { deps } = client(server);
    const sock = new Mutant(deps);
    sock.connect();
    server.flush();
    server.expire('tok-a');
    sock.requestPlaylist();
    await settle();
    server.flush();
    expect(server.liveListeners(server.sockets[0])).toBe(1);
    expect(() => server.assertNoLiveListeners({ except: [server.sockets[1]] })).toThrow(/socket #1 \(tok-a\): playlist_ready x1/);
  });

  it('a transport drop reconnects with the same auth, and a request made while down reaches the server after reconnect', () => {
    const server = new FakeSocketServer({ validTokens: ['tok-a'] });
    const { sock, states } = client(server);
    sock.connect();
    server.flush();
    server.drop();
    expect(states).toEqual(['connecting', 'connected', 'disconnected']);
    const reqId = sock.requestPlaylist(); // emitted into the dropped socket: buffered by socket.io
    expect(server.receivedOn('request_playlist')).toEqual([]);
    server.flush(); // the manager's reconnect: same socket, same token
    expect(server.sockets).toHaveLength(1);
    expect(states[states.length - 1]).toBe('connected');
    // socket.io flushes the buffered request, THEN KokonadaSocket's connect handler re-sends the
    // pending one: the server sees the same reqId twice (recorded as an OPS-067 finding).
    expect(server.receivedOn('request_playlist')).toEqual([{ reqId }, { reqId }]);
  });

  it('scripted out-of-order delivery: the client sees the scripted order, and the stale answer is dropped by the reqId gate', () => {
    const server = new FakeSocketServer({ validTokens: ['tok-a'] });
    const seen: string[] = [];
    const { sock } = client(server, {
      onPlaylist: (p) => { seen.push(`ready:${p.reqId}`); },
      onGenerationError: (m) => { seen.push(`error:${m}`); },
    });
    sock.connect();
    server.flush();
    const first = sock.requestPlaylist();
    const second = sock.requestPlaylist();
    server.send('playlist_ready', { reqId: first, tracks: [] });             // 0: the superseded answer
    server.send('playlist_error', { reqId: second, message: 'late' });       // 1
    server.send('playlist_ready', { reqId: second, tracks: [] });            // 2
    const delivered = server.deliver([2, 0, 1]);
    expect(delivered.map((p) => (p.payload as { reqId: number }).reqId)).toEqual([second, first, second]);
    // In queue order the client would see ['error:late', `ready:${second}`]; scripted, it sees:
    expect(seen).toEqual([`ready:${second}`, 'error:late']);
  });

  it('seeded delivery reproduces the same order run after run', () => {
    const orders = [1, 2].map(() => {
      const server = new FakeSocketServer({ validTokens: ['tok-a'] });
      const heard: string[] = [];
      const { sock } = client(server, { onAssembling: (m) => { heard.push(String(m)); } });
      sock.connect();
      server.flush();
      for (let i = 0; i < 5; i += 1) server.send('live_assembling', { message: `m${i}` });
      server.deliverSeeded(42);
      return heard.join(',');
    });
    expect(orders[0]).toBe(orders[1]);
    expect(orders[0]).not.toBe('m0,m1,m2,m3,m4'); // genuinely out of order
    expect(permutation(5, 42)).toEqual(permutation(5, 42));
    expect(permutation(5, 42)).not.toEqual([0, 1, 2, 3, 4]);
    expect([...permutation(5, 42)].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('a manual disconnect leaves 0 live listeners on every socket', () => {
    const server = new FakeSocketServer({ validTokens: ['tok-a'] });
    const { sock } = client(server);
    sock.connect();
    server.flush();
    expect(server.liveListeners()).toBe(8); // the eight events KokonadaSocket listens to
    sock.disconnect();
    expect(server.liveListeners()).toBe(0);
    expect(() => server.assertNoLiveListeners()).not.toThrow();
  });

  it('a packet for a socket that is not connected is dropped, not delivered late', () => {
    const server = new FakeSocketServer({ validTokens: ['tok-a'] });
    const { sock, onPlaylist } = client(server);
    sock.connect();
    server.flush();
    const reqId = sock.requestPlaylist();
    server.send('playlist_ready', { reqId, tracks: [] });
    server.drop();
    server.deliver();
    expect(onPlaylist).not.toHaveBeenCalled();
    expect(server.dropped.map((p) => p.event)).toEqual(['playlist_ready']);
  });
});
