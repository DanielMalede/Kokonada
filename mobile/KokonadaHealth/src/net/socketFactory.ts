import { io } from 'socket.io-client';
import { BACKEND_URL } from '../health/config';
import type { SocketLike } from './socketClient';

// On-device adapter: builds a real Socket.IO connection behind the SocketLike port
// KokonadaSocket depends on. Transient reconnection (backoff, attempt cap) is the
// library's job — KokonadaSocket only takes over on auth_expired, where the dead
// token must not be reused. `autoConnect: false` so KokonadaSocket owns the open.
// Pinned over the real socket.io-client in __tests__/socketFactory.test.ts; KokonadaSocket is tested
// against a fake socket.
//
// RA-6: once the Manager has spent `reconnectionAttempts` it gives up and emits 'reconnect_failed' on
// ITSELF, never on the socket (socket.io-client manager.js:365-369). The port carries it under the same
// name, so KokonadaSocket can drop a socket that will never come back.
const MANAGER_EVENT = 'reconnect_failed';

export function createBackendSocket(token: string): SocketLike {
  const socket = io(BACKEND_URL, {
    // Polling-first (the socket.io default the working web app uses), then auto-upgrade to
    // websocket. websocket-ONLY connects the handshake but can silently fail to round-trip
    // data frames behind proxies (Railway) — the socket shows CONNECTED yet requests never
    // reach the server and no reply returns. Polling guarantees delivery; ws is an upgrade.
    transports: ['polling', 'websocket'],
    auth: { token },
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });
  return {
    on: (event, cb) => {
      if (event === MANAGER_EVENT) socket.io.on(MANAGER_EVENT, cb as any);
      else socket.on(event, cb as any);
    },
    off: (event, cb) => {
      if (event === MANAGER_EVENT) socket.io.off(MANAGER_EVENT, cb as any);
      else socket.off(event, cb as any);
    },
    emit: (event, payload) => { socket.emit(event, payload); },
    connect: () => { socket.connect(); },
    disconnect: () => { socket.disconnect(); },
  };
}
