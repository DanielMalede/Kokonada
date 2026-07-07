// Holds a generated playlist and a cursor over its PLAYABLE tracks. YouTube-only
// tracks (no Spotify URI) are data, not playable, so navigation skips them. The
// cursor never runs off either edge.

export interface QueueTrack {
  id: string;
  uri: string | null; // Spotify URI, or null for a non-playable (data-only) track
  title: string;
  artist: string;
}

function isPlayable(t: QueueTrack): boolean {
  return typeof t.uri === 'string' && t.uri.length > 0;
}

function sanitize(raw: unknown[]): QueueTrack[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((t): t is QueueTrack => !!t && typeof t === 'object' && typeof (t as any).id === 'string')
    .map((t) => ({
      id: t.id,
      uri: typeof t.uri === 'string' && t.uri.length > 0 ? t.uri : null,
      title: typeof (t as any).title === 'string' ? (t as any).title : t.id,
      artist: typeof (t as any).artist === 'string' ? (t as any).artist : '',
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
}
