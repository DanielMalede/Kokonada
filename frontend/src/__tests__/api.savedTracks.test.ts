import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setTrackSaved, fetchTracksSaved } from '../lib/api';

const BACKEND = 'http://localhost:5000';
const SAVED_URL = `${BACKEND}/api/integrations/spotify/saved-tracks`;

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('setTrackSaved (Bug 7 — like/unlike)', () => {
  it('PUTs the track id when saving', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await setTrackSaved(BACKEND, 'trk1', true);

    expect(fetchMock).toHaveBeenCalledWith(SAVED_URL, expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ ids: ['trk1'] }),
    }));
  });

  it('DELETEs the track id when unsaving', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await setTrackSaved(BACKEND, 'trk1', false);

    expect(fetchMock).toHaveBeenCalledWith(SAVED_URL, expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws a reconnect-flagged error on a 409 (missing scope)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ reason: 'reconnect_required' }) }));
    await expect(setTrackSaved(BACKEND, 'trk1', true)).rejects.toMatchObject({ reconnect: true });
  });
});

describe('fetchTracksSaved', () => {
  it('GETs the saved-state map for the given ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: { a: true, b: false } }) });
    vi.stubGlobal('fetch', fetchMock);

    const out = await fetchTracksSaved(BACKEND, ['a', 'b']);

    expect(fetchMock).toHaveBeenCalledWith(`${SAVED_URL}?ids=a%2Cb`, expect.objectContaining({ method: 'GET' }));
    expect(out).toEqual({ a: true, b: false });
  });

  it('returns {} for an empty id list without calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchTracksSaved(BACKEND, [])).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
