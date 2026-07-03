import { io } from 'socket.io-client';
import { BACKEND_URL } from '../health/config';
import type { SocketLike } from './socketClient';

// On-device adapter: builds a real Socket.IO connection behind the SocketLike port
// KokonadaSocket depends on. Transient reconnection (backoff, attempt cap) is the
// library's job — KokonadaSocket only takes over on auth_expired, where the dead
// token must not be reused. `autoConnect: false` so KokonadaSocket owns the open.
// Outside the jest graph; KokonadaSocket is tested against a fake socket.
export function createBackendSocket(token: string): SocketLike {
  const socket = io(BACKEND_URL, {
    transports: ['websocket'],
    auth: { token },
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
  });
  return {
    on: (event, cb) => { socket.on(event, cb as any); },
    off: (event, cb) => { socket.off(event, cb as any); },
    emit: (event, payload) => { socket.emit(event, payload); },
    connect: () => { socket.connect(); },
    disconnect: () => { socket.disconnect(); },
  };
}
