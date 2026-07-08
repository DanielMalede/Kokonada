import { createLiveModeStore, LIVE_MODE_KEY } from '../liveModeStore';

function fakeKV(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getString: (k: string) => m.get(k),
    set: (k: string, v: string) => { m.set(k, v); },
    _dump: () => m,
  };
}

describe('liveModeStore', () => {
  it('defaults to Manual (liveMode false)', () => {
    expect(createLiveModeStore().getState().liveMode).toBe(false);
  });

  it('setLiveMode flips the flag and persists it', () => {
    const kv = fakeKV();
    const s = createLiveModeStore(kv);
    s.getState().setLiveMode(true);
    expect(s.getState().liveMode).toBe(true);
    expect(kv._dump().get(LIVE_MODE_KEY)).toBe('1');
    s.getState().setLiveMode(false);
    expect(kv._dump().get(LIVE_MODE_KEY)).toBe('0');
  });

  it('hydrate restores a persisted Live preference across restarts', () => {
    const s = createLiveModeStore(fakeKV({ [LIVE_MODE_KEY]: '1' }));
    expect(s.getState().liveMode).toBe(false); // not read until hydrate
    s.getState().hydrate();
    expect(s.getState().liveMode).toBe(true);
  });

  it('hydrate with no stored value leaves the default (Manual)', () => {
    const s = createLiveModeStore(fakeKV());
    s.getState().hydrate();
    expect(s.getState().liveMode).toBe(false);
  });

  it('degrades safely with no KV backend (in-memory, never throws)', () => {
    const s = createLiveModeStore();
    expect(() => { s.getState().setLiveMode(true); s.getState().hydrate(); }).not.toThrow();
    expect(s.getState().liveMode).toBe(true);
  });
});
