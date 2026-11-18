// QA-045 (socket): a shared, stateful socket fake behind the SocketLike port (src/net/socketClient.ts).
//
// It models what socket.io-client 4.8.3 and the backend's socket auth actually do, because those are
// the behaviours a screen must survive:
//   · connect() starts a handshake that completes on flush(), never synchronously (the network is async);
//   · the server middleware refuses a token it does not accept (backend/app/sockets/index.js:42-71):
//     the client gets connect_error 'unauthorized' and the socket is DESTROYED, so it never retries
//     on its own (socket.io-client build/cjs/socket.js:520-527);
//   · a packet that arrives after the handshake token expired gets 'auth_expired' and a server
//     disconnect (index.js:93-99): 'io server disconnect', no reconnect;
//   · a transport drop is 'transport close' and the manager reconnects the SAME socket with the SAME
//     auth on the next flush();
//   · emit() while not connected is buffered and flushed on connect, BEFORE the 'connect' handlers
//     run (socket.js:281, 610-632); a server packet for a socket that is not connected is dropped;
//   · off(event, fn) removes the first matching registration (component-emitter).
// Every socket keeps a live listener registry; server packets queue until flush()/deliver(), which
// can deliver them in any explicit or seeded order.

import type { SocketLike } from '../net/socketClient';

type Handler = (payload?: any) => void;
export interface Packet { socket: FakeSocket; event: string; payload?: unknown }

/** A seeded permutation of 0..n-1 (mulberry32 + Fisher-Yates): the same seed gives the same order. */
export function permutation(n: number, seed: number): number[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export class FakeSocket implements SocketLike {
  state: 'idle' | 'connecting' | 'connected' | 'disconnected' = 'idle';
  /** socket.io's `active`: false once destroyed (refused, server-disconnected or closed by the client). */
  active = false;
  private handlers = new Map<string, Handler[]>();
  private sendBuffer: Array<{ event: string; payload?: unknown }> = [];

  constructor(private readonly server: FakeSocketServer, readonly token: string, readonly index: number) {}

  on(event: string, cb: Handler): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
  }

  off(event: string, cb: Handler): void {
    const list = this.handlers.get(event) ?? [];
    const i = list.indexOf(cb);
    if (i !== -1) this.handlers.set(event, [...list.slice(0, i), ...list.slice(i + 1)]);
  }

  emit(event: string, payload?: unknown): void {
    if (this.state === 'connected') this.server.clientPacket(this, event, payload);
    else this.sendBuffer.push({ event, payload });
  }

  connect(): void {
    if (this.state === 'connected' || this.state === 'connecting') return;
    this.state = 'connecting';
    this.active = true;
    this.server.requestHandshake(this);
  }

  disconnect(): void {
    const wasConnected = this.state === 'connected';
    this.state = 'disconnected';
    this.active = false;
    if (wasConnected) this.fire('disconnect', 'io client disconnect');
  }

  listenerCount(event?: string): number {
    if (event != null) return (this.handlers.get(event) ?? []).length;
    let n = 0;
    for (const list of this.handlers.values()) n += list.length;
    return n;
  }

  liveEvents(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [e, list] of this.handlers) if (list.length) out[e] = list.length;
    return out;
  }

  /** @internal the server's side of the handshake */
  completeHandshake(accepted: boolean): void {
    if (!this.active) return; // closed by the client while the handshake was in flight
    if (!accepted) {
      this.state = 'disconnected';
      this.active = false;
      const err = Object.assign(new Error('unauthorized'), { data: undefined });
      this.fire('connect_error', err);
      return;
    }
    this.state = 'connected';
    const buffered = this.sendBuffer.splice(0);
    for (const p of buffered) {
      if (this.state !== 'connected') { this.sendBuffer.push(p); continue; }
      this.server.clientPacket(this, p.event, p.payload);
    }
    if (this.state === 'connected') this.fire('connect');
  }

  /** @internal a server packet reaching this socket */
  receive(event: string, payload?: unknown): boolean {
    if (this.state !== 'connected') return false;
    this.fire(event, payload);
    return true;
  }

  /** @internal the server closed the session */
  serverDisconnect(): void {
    if (this.state !== 'connected') return;
    this.state = 'disconnected';
    this.active = false;
    this.fire('disconnect', 'io server disconnect');
  }

  /** @internal the transport dropped: the manager will reconnect */
  transportClose(): void {
    if (this.state !== 'connected') return;
    this.state = 'disconnected';
    this.fire('disconnect', 'transport close');
    if (this.active) {
      this.state = 'connecting';
      this.server.requestHandshake(this);
    }
  }

  private fire(event: string, payload?: unknown): void {
    for (const h of [...(this.handlers.get(event) ?? [])]) h(payload);
  }
}

export interface FakeSocketServerOptions { validTokens?: string[] }

export class FakeSocketServer {
  readonly sockets: FakeSocket[] = [];
  readonly handshakes: Array<{ socket: FakeSocket; token: string; accepted: boolean }> = [];
  /** Client packets the server accepted, in arrival order. */
  readonly received: Packet[] = [];
  /** Client packets refused after the token expired (they never reached a handler). */
  readonly refused: Packet[] = [];
  /** Server packets addressed to a socket that was not connected when delivered. */
  readonly dropped: Packet[] = [];
  private valid: Set<string>;
  private expired = new Set<string>();
  private pending: FakeSocket[] = [];
  private queue: Packet[] = [];

  constructor(options: FakeSocketServerOptions = {}) {
    this.valid = new Set(options.validTokens ?? []);
  }

  /** The factory to inject as KokonadaSocketDeps.createSocket. */
  createSocket = (token: string): SocketLike => {
    const s = new FakeSocket(this, token, this.sockets.length + 1);
    this.sockets.push(s);
    return s;
  };

  latest(): FakeSocket {
    const s = this.sockets[this.sockets.length - 1];
    if (!s) throw new Error('FakeSocketServer: no socket has been created');
    return s;
  }

  accept(token: string): void { this.valid.add(token); this.expired.delete(token); }
  /** The token's JWT expires: handshakes are refused, and a connected socket's next packet gets auth_expired. */
  expire(token: string): void { this.expired.add(token); }
  private accepts(token: string): boolean { return this.valid.has(token) && !this.expired.has(token); }

  /** @internal */
  requestHandshake(socket: FakeSocket): void { this.pending.push(socket); }

  /** @internal */
  clientPacket(socket: FakeSocket, event: string, payload?: unknown): void {
    if (!this.accepts(socket.token)) {
      this.refused.push({ socket, event, payload });
      socket.receive('auth_expired');
      socket.serverDisconnect();
      return;
    }
    this.received.push({ socket, event, payload });
  }

  /** Complete every pending handshake, then deliver the queued server packets in order. */
  flush(): void {
    this.completeHandshakes();
    this.deliver();
  }

  completeHandshakes(): void {
    for (const s of this.pending.splice(0)) {
      const accepted = this.accepts(s.token);
      this.handshakes.push({ socket: s, token: s.token, accepted });
      s.completeHandshake(accepted);
    }
  }

  /** Queue a server packet for a socket (the latest by default). */
  send(event: string, payload?: unknown, socket: FakeSocket = this.latest()): void {
    this.queue.push({ socket, event, payload });
  }

  /** Deliver the queued packets, in `order` (a permutation of their indices) or as queued. */
  deliver(order?: number[]): Packet[] {
    const queued = this.queue.splice(0);
    const idx = order ?? queued.map((_, i) => i);
    if (idx.length !== queued.length || [...idx].sort((a, b) => a - b).some((v, i) => v !== i)) {
      this.queue.unshift(...queued);
      throw new Error(`FakeSocketServer.deliver: ${JSON.stringify(order)} is not a permutation of the ${queued.length} queued packets`);
    }
    const delivered = idx.map((i) => queued[i]);
    for (const p of delivered) if (!p.socket.receive(p.event, p.payload)) this.dropped.push(p);
    return delivered;
  }

  /** Deliver the queued packets in a seeded order: the same seed reproduces the same order. */
  deliverSeeded(seed: number): Packet[] {
    return this.deliver(permutation(this.queue.length, seed));
  }

  /** The transport under a socket (the latest by default) drops. */
  drop(socket: FakeSocket = this.latest()): void { socket.transportClose(); }

  receivedOn(event: string, socket?: FakeSocket): unknown[] {
    return this.received.filter((p) => p.event === event && (socket == null || p.socket === socket)).map((p) => p.payload);
  }

  liveListeners(socket?: FakeSocket): number {
    return (socket ? [socket] : this.sockets).reduce((n, s) => n + s.listenerCount(), 0);
  }

  /** Throws, naming each socket that still holds listeners (except the ones passed). */
  assertNoLiveListeners(options: { except?: FakeSocket[] } = {}): void {
    const leaks = this.sockets
      .filter((s) => !(options.except ?? []).includes(s) && s.listenerCount() > 0)
      .map((s) => `  socket #${s.index} (${s.token}): ${Object.entries(s.liveEvents()).map(([e, n]) => `${e} x${n}`).join(', ')}`);
    if (leaks.length) throw new Error(`QA-045: socket listeners still live:\n${leaks.join('\n')}`);
  }
}
