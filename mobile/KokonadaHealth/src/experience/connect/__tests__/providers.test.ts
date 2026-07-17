import { PROVIDERS, providersByKind, type Provider } from '../providers';

// §4 Connect Services provider registry. The registry encodes the HONEST truth of each
// integration today — Spotify is halted (external 5-user cap, no known fix), YouTube is
// deferred (one OAuth-verification blocker), a wearable is the one live path. Nothing in
// the registry may imply a working OAuth connect for a halted/deferred provider.

describe('connect providers registry', () => {
  const byId = (id: string): Provider | undefined => PROVIDERS.find((p) => p.id === id);

  it('Spotify is a HALTED music provider (new connections paused app-wide)', () => {
    const spotify = byId('spotify');
    expect(spotify).toBeDefined();
    expect(spotify!.kind).toBe('music');
    expect(spotify!.state).toBe('halted');
  });

  it('YouTube Music is a DEFERRED music provider (awaiting Google review)', () => {
    const youtube = byId('youtube');
    expect(youtube).toBeDefined();
    expect(youtube!.kind).toBe('music');
    expect(youtube!.state).toBe('deferred');
  });

  it('the wearable is the one ENABLED provider (the single live connect path)', () => {
    const wearable = byId('wearable');
    expect(wearable).toBeDefined();
    expect(wearable!.kind).toBe('wearable');
    expect(wearable!.state).toBe('enabled');
  });

  it('every provider carries a non-empty label AND an honest "why" reason line', () => {
    expect(PROVIDERS.length).toBeGreaterThan(0);
    for (const p of PROVIDERS) {
      expect(p.label.trim().length).toBeGreaterThan(0);
      expect(p.why.trim().length).toBeGreaterThan(0);
    }
  });

  it('the Spotify reason line uses the compliance-cleared copy (no agency/platform-wide claim)', () => {
    // compliance-auditor NEEDS-CHANGE: Spotify Developer Policy accurate-representation clause.
    // The reason must NOT attribute agency to Spotify nor read as platform-wide.
    const spotify = byId('spotify')!;
    expect(spotify.why).toBe("Connecting Spotify isn't available in Kokonada right now.");
    expect(spotify.why).not.toMatch(/app-wide/i);
    expect(spotify.why).not.toMatch(/Spotify has paused/i);
  });

  it('the YouTube reason line states the deferred (Google-review) truth', () => {
    expect(byId('youtube')!.why).toBe('Coming once our Google review is complete.');
  });

  it('NO music provider is connectable today — the registry never implies a live OAuth mint', () => {
    // Halted/deferred is the whole point: there is no enabled music provider, and no
    // provider carries a connectUrl/oauth field that a row could mistakenly wire.
    for (const p of providersByKind('music')) {
      expect(p.state).not.toBe('enabled');
      expect(p as unknown as Record<string, unknown>).not.toHaveProperty('connectUrl');
      expect(p as unknown as Record<string, unknown>).not.toHaveProperty('oauth');
    }
  });

  it('providersByKind partitions the registry by kind (music rows vs the wearable protagonist)', () => {
    const music = providersByKind('music').map((p) => p.id).sort();
    expect(music).toEqual(['spotify', 'youtube']);
    expect(providersByKind('wearable').map((p) => p.id)).toEqual(['wearable']);
  });
});
