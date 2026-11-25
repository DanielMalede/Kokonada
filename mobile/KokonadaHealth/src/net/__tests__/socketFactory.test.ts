// RA-6 (S1, PR #309 review): socket.io-client's Manager gives up after `reconnectionAttempts` failed
// reconnects and emits 'reconnect_failed' on the MANAGER, never on the socket (socket.io-client 4.8.3
// build/cjs/manager.js:365-369). The SocketLike port only listened on the socket, so KokonadaSocket
// never heard that its socket was dead, and ensureOpen() trusted it for the rest of the process. The
// adapter forwards the Manager's give-up through the port under the same name.
//
// The socket under the adapter is the REAL socket.io-client (autoConnect off, so nothing touches the
// network); `io` is wrapped only to hand the test the socket it built.

const mockBuilt: any[] = [];
jest.mock('socket.io-client', () => {
  const actual = jest.requireActual('socket.io-client');
  return { ...actual, io: (...args: any[]) => { const s = actual.io(...args); mockBuilt.push(s); return s; } };
});

import { createBackendSocket } from '../socketFactory';

// The Manager's own give-up branch: every spent attempt is one backoff.duration(), and reconnect()
// with the attempts spent emits 'reconnect_failed' instead of scheduling another try.
function spendAttemptsAndGiveUp(manager: any): void {
  while (manager.backoff.attempts < manager.reconnectionAttempts()) manager.backoff.duration();
  manager.reconnect();
}

describe('createBackendSocket — the SocketLike port over a real socket.io-client socket', () => {
  afterEach(() => { for (const s of mockBuilt.splice(0)) s.disconnect(); });

  it('the Manager gives up after 5 failed reconnects, and its reconnect_failed reaches the port\'s listener; off() removes it', () => {
    const port = createBackendSocket('tok');
    const raw = mockBuilt[0];
    expect(raw.io.reconnectionAttempts()).toBe(5);
    const heard = jest.fn();
    port.on('reconnect_failed', heard);
    spendAttemptsAndGiveUp(raw.io);
    expect(heard).toHaveBeenCalledTimes(1);

    port.off('reconnect_failed', heard);
    spendAttemptsAndGiveUp(raw.io);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('every other event stays on the socket: a refused handshake\'s connect_error and a server disconnect reach the port', () => {
    const port = createBackendSocket('tok');
    const raw = mockBuilt[0];
    const refused = jest.fn();
    const closed = jest.fn();
    port.on('connect_error', refused);
    port.on('disconnect', closed);
    raw.emitReserved('connect_error', new Error('unauthorized'));
    raw.emitReserved('disconnect', 'io server disconnect');
    expect(refused).toHaveBeenCalledWith(expect.objectContaining({ message: 'unauthorized' }));
    expect(closed).toHaveBeenCalledWith('io server disconnect');
    port.off('connect_error', refused);
    raw.emitReserved('connect_error', new Error('unauthorized'));
    expect(refused).toHaveBeenCalledTimes(1);
  });
});
