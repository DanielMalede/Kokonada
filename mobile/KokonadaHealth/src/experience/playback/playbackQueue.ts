// Holds a generated playlist and a cursor over its PLAYABLE tracks. YouTube-only
// tracks (no Spotify URI) are data, not playable, so navigation skips them. The
// cursor never runs off either edge.

// The "why this track" mix-receipt built by the backend from real signals (familiar vs
// discovery + the mood/heart trigger and target tempo). Rendered on Now Playing.
export interface TrackReceipt {
  label: string;
  detail?: string;
  // Wave 2.8 enriched discovery: the non-Spotify favorite this discovery track anchors to
  // ("Because you love <title> by <artist>"). Additive over the backend `receipt.anchor`.
  anchor?: { title: string; artist: string };
}

export interface QueueTrack {
  id: string;
  uri: string | null; // Spotify URI, or null for a non-playable (data-only) track
  title: string;
  artist: string;
  // NOTE: no album cover here — the Now Playing cover is decoupled from the queue and
  // resolved from the LIVE App Remote player state (see coverArtResolver/nowPlayingStore).
  receipt: TrackReceipt | null; // mix-receipt, or null when a legacy payload omits it
  // Identifies a discovery track for playback-failure reporting: `youtube:<id>` / `spotify:<id>`.
  // A familiar track carries none → null (Phase 2 discovery playback report).
  recordingKey: string | null;
}

function isPlayable(t: QueueTrack): boolean {
  return typeof t.uri === 'string' && t.uri.length > 0;
}

// Defensive: a legacy payload (pre-Wave-2.8) carries no receipt, and a malformed value
// must never crash the queue — it defaults to null. A receipt is kept only when it is an
// object with a non-empty string label (detail stays optional).
function sanitizeReceipt(r: unknown): TrackReceipt | null {
  if (!r || typeof r !== 'object') return null;
  const label = (r as any).label;
  if (typeof label !== 'string' || label.length === 0) return null;
  const detail = (r as any).detail;
  const receipt: TrackReceipt = typeof detail === 'string' && detail.length > 0 ? { label, detail } : { label };
  // Keep an anchor ONLY when both fields are non-empty strings (mirror the detail keep-only
  // pattern): a blank / half / unknown anchor is stripped so the UI never makes a false claim.
  const anchor = (r as any).anchor;
  if (anchor && typeof anchor === 'object') {
    const title = (anchor as any).title;
    const artist = (anchor as any).artist;
    if (typeof title === 'string' && title.trim() && typeof artist === 'string' && artist.trim()) {
      receipt.anchor = { title, artist };
    }
  }
  return receipt;
}

function sanitize(raw: unknown[]): QueueTrack[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((t): t is QueueTrack => !!t && typeof t === 'object' && typeof (t as any).id === 'string')
    .map((t) => ({
      id: t.id,
      uri: typeof t.uri === 'string' && t.uri.length > 0 ? t.uri : null,
      title: typeof (t as any).title === 'string' ? (t as any).title : t.id,
      artist: typeof (t as any).artist === 'string' ? (t as any).artist : '',
      receipt: sanitizeReceipt((t as any).receipt),
      recordingKey: typeof (t as any).recordingKey === 'string' && (t as any).recordingKey ? (t as any).recordingKey : null,
    }));
}

export class PlaybackQueue {
  private tracks: QueueTrack[] = [];
  private index = 0;

  load(raw: unknown[]): void {
    this.tracks = sanitize(raw);
    // Point at the first playable track (skip leading data-only tracks).
    this.index = this.tracks.findIndex(isPlayable);
    if (this.index < 0) this.index = this.tracks.length; // none playable
  }

  size(): number {
    return this.tracks.length;
  }

  current(): QueueTrack | null {
    const t = this.tracks[this.index];
    return t && isPlayable(t) ? t : null;
  }

  private findPlayable(from: number, step: 1 | -1): number {
    for (let i = from; i >= 0 && i < this.tracks.length; i += step) {
      if (isPlayable(this.tracks[i])) return i;
    }
    return -1;
  }

  hasNext(): boolean {
    return this.findPlayable(this.index + 1, 1) !== -1;
  }

  next(): QueueTrack | null {
    const nextIdx = this.findPlayable(this.index + 1, 1);
    if (nextIdx === -1) return null; // stay put at the last playable track
    this.index = nextIdx;
    return this.tracks[this.index];
  }

  prev(): QueueTrack | null {
    const prevIdx = this.findPlayable(this.index - 1, -1);
    if (prevIdx === -1) return null; // clamp at the first playable track
    this.index = prevIdx;
    return this.tracks[this.index];
  }

  // The current track's position among PLAYABLE tracks only — i.e. its row index in the
  // session playlist (which the backend builds from exactly the Spotify-URI tracks, in
  // order). Data-only tracks (uri:null) exist in the queue but not the playlist. (D-1)
  playableIndex(): number {
    let n = 0;
    for (let i = 0; i < this.index && i < this.tracks.length; i++) {
      if (isPlayable(this.tracks[i])) n++;
    }
    return n;
  }

  // Move the cursor to the queued track with this URI (D-1: adopt a native auto-advance /
  // in-Spotify jump to one of OUR tracks). Returns null — cursor untouched — for a URI we
  // never queued (a foreign track the user played directly in Spotify).
  seekToUri(uri: string): QueueTrack | null {
    if (typeof uri !== 'string' || !uri) return null;
    const idx = this.tracks.findIndex((t) => isPlayable(t) && t.uri === uri);
    if (idx === -1) return null;
    this.index = idx;
    return this.tracks[idx];
  }

  // Move the cursor to the queued track with this id — the Up-Next sheet's tap-to-jump.
  // Matches by the stable track id (not the URI) so an exact tapped row is honoured.
  // Returns null — cursor untouched — for an id that isn't a PLAYABLE queued track
  // (an unknown id, or a data-only row a user should not be able to jump onto).
  seekToId(id: string): QueueTrack | null {
    if (typeof id !== 'string' || !id) return null;
    const idx = this.tracks.findIndex((t) => isPlayable(t) && t.id === id);
    if (idx === -1) return null;
    this.index = idx;
    return this.tracks[idx];
  }

  // Read-only ordered snapshot of the whole queue (playable AND data-only rows) for the
  // Up-Next sheet. A COPY, so a consumer can never mutate the live queue behind the cursor.
  list(): QueueTrack[] {
    return this.tracks.slice();
  }
}
