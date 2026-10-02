import { PROVIDERS, providersByKind, type Provider } from '../providers';

// §4 Connect Services provider registry. The registry encodes the HONEST truth of each
// integration today — Spotify is halted (external 5-user cap, no known fix), YouTube is
// deferred (connecting it is sealed on the server in code, DEC-122, and the row stays visible
// as deferred, DEC-043), a wearable is the one live path. Nothing in the registry may imply a
// working OAuth connect for a halted/deferred provider.

describe('connect providers registry', () => {
  const byId = (id: string): Provider | undefined => PROVIDERS.find((p) => p.id === id);

  it('Spotify is a HALTED music provider (new connections paused app-wide)', () => {
    const spotify = byId('spotify');
    expect(spotify).toBeDefined();
    expect(spotify!.kind).toBe('music');
    expect(spotify!.state).toBe('halted');
  });

  // RETIRED under DEC-091 (HX-3): the title named the provider "YouTube Music" and the state
  // "awaiting Google review". Under DEC-122 connecting YouTube is sealed in code; the row is named
  // "YouTube" and stays visible as deferred (DEC-043).
  it('YouTube is a DEFERRED music provider named "YouTube" (connecting it is sealed, DEC-122)', () => {
    const youtube = byId('youtube');
    expect(youtube).toBeDefined();
    expect(youtube!.label).toBe('YouTube');
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

  // REVERSED under DEC-123, item 4 (HX-3): the reason line was 'Coming once our Google review is
  // complete.' It is now the compliance-cleared line, worded like the cleared Spotify line so the two
  // music rows read as a set and differ only in the time word. Plain ASCII apostrophe, as Spotify's.
  it('the YouTube reason line is the compliance-cleared copy (no review, no promise, no YouTube Music)', () => {
    const why = byId('youtube')!.why;
    expect(why).toBe("Connecting YouTube isn't available in Kokonada yet.");
    expect(why).not.toContain('YouTube Music');
    expect(why).not.toMatch(/google/i);
    expect(why).not.toMatch(/review/i);
    expect(why).not.toMatch(/plays/i);
    expect(why).not.toMatch(/\d/);
    expect(why).not.toMatch(/[‘’]/); // never a curly apostrophe
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
