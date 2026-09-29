// H2 (DT-H2-4 option P1): the boot-time Spotify connect runs ONLY for a signed-in account whose
// Spotify link the server confirms right now (GET /api/integrations/status → spotifyConnected).
// Without this, SpotifyRemote.connect() → NOT_LOGGED_IN → authorize() opened Spotify's login
// screen at launch for signed-out or never-linked users (spotifyRemoteAdapter.ts). Any failure to
// confirm the link fails CLOSED: the player then connects on first play instead, a path that
// already exists.
//
// Stateful fakes: `server` is the status the fake API answers from (a test flips it); `player`
// records real connect attempts and can be made to reject like the native remote does.

import { connectPlayerIfLinked } from '../playerBootGate';
import type { ApiResult } from '../../../net/apiClient';
import type { IntegrationsStatus } from '../../profile/profileController';

function fakeServer(initial: ApiResult<IntegrationsStatus> | 'throw') {
  let reply = initial;
  const fetchIntegrations = jest.fn(async (): Promise<ApiResult<IntegrationsStatus>> => {
    if (reply === 'throw') throw new Error('socket hang up');
    return reply;
  });
  return { fetchIntegrations, set: (r: typeof reply) => { reply = r; } };
}

function fakePlayer(opts: { rejectWith?: Error } = {}) {
  const attempts: number[] = [];
  const connect = jest.fn(async () => {
    attempts.push(Date.now());
    if (opts.rejectWith) throw opts.rejectWith;
    return true;
  });
  return { connect, attempts };
}

describe('connectPlayerIfLinked', () => {
  it('Spotify linked on the server → connects exactly once', async () => {
    const server = fakeServer({ ok: true, data: { spotifyConnected: true } });
    const player = fakePlayer();
    await expect(connectPlayerIfLinked({ fetchIntegrations: server.fetchIntegrations, connect: player.connect })).resolves.toBe(true);
    expect(player.connect).toHaveBeenCalledTimes(1);
  });

  it('not linked → never connects (no Spotify login screen at launch)', async () => {
    const server = fakeServer({ ok: true, data: { spotifyConnected: false } });
    const player = fakePlayer();
    await expect(connectPlayerIfLinked({ fetchIntegrations: server.fetchIntegrations, connect: player.connect })).resolves.toBe(false);
    expect(player.connect).not.toHaveBeenCalled();
  });

  it('the status read fails (401 / offline) → never connects', async () => {
    const server = fakeServer({ ok: false, status: 401, error: 'unauthorized' });
    const player = fakePlayer();
    await connectPlayerIfLinked({ fetchIntegrations: server.fetchIntegrations, connect: player.connect });
    expect(player.connect).not.toHaveBeenCalled();
  });

  it('the status read throws → never connects and never throws', async () => {
    const server = fakeServer('throw');
    const player = fakePlayer();
    await expect(connectPlayerIfLinked({ fetchIntegrations: server.fetchIntegrations, connect: player.connect })).resolves.toBe(false);
    expect(player.connect).not.toHaveBeenCalled();
  });

  it('a malformed status (spotifyConnected not strictly true) → never connects', async () => {
    const server = fakeServer({ ok: true, data: { spotifyConnected: 'yes' as unknown as boolean } });
    const player = fakePlayer();
    await connectPlayerIfLinked({ fetchIntegrations: server.fetchIntegrations, connect: player.connect });
    expect(player.connect).not.toHaveBeenCalled();
  });

  it('a rejecting connect is swallowed — the boot sequence never sees it', async () => {
    const server = fakeServer({ ok: true, data: { spotifyConnected: true } });
    const player = fakePlayer({ rejectWith: new Error('remote died') });
    await expect(connectPlayerIfLinked({ fetchIntegrations: server.fetchIntegrations, connect: player.connect })).resolves.toBe(false);
    expect(player.connect).toHaveBeenCalledTimes(1);
  });

  it('reads the link FRESH on every call (a link revoked since the last boot is honoured)', async () => {
    const server = fakeServer({ ok: true, data: { spotifyConnected: true } });
    const player = fakePlayer();
    await connectPlayerIfLinked({ fetchIntegrations: server.fetchIntegrations, connect: player.connect });
    server.set({ ok: true, data: { spotifyConnected: false } });
    await connectPlayerIfLinked({ fetchIntegrations: server.fetchIntegrations, connect: player.connect });
    expect(server.fetchIntegrations).toHaveBeenCalledTimes(2);
    expect(player.connect).toHaveBeenCalledTimes(1);
  });
});
