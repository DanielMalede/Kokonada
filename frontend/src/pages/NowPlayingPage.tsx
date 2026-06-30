import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Play, Pause, SkipForward, SkipBack, Disc3, Heart } from 'lucide-react';
import SpotifyLogo from '@/components/SpotifyLogo';
import { toast } from 'sonner';
import type { AppDispatch, RootState } from '@/store';
import { setSdkState, setCurrentIndex } from '@/store/slices/playerSlice';
import { spotifyPlayerService } from '@/services/spotifyPlayer';
import { audioPlayer } from '@/services/audioPlayer';
import { useSocket } from '@/hooks/useSocket';
import { MOODS, selectedMoodKey } from '@/lib/moods';
import { setTrackSaved, fetchTracksSaved, exportPlaylist, playTracks } from '@/lib/api';
import { sanitizeTrackUris } from '@/lib/spotifyUri';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

function reconnectToast(message: string) {
  toast.error(message, {
    action: { label: 'Reconnect', onClick: () => { window.location.href = '/integrations'; } },
  });
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function NowPlayingPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { skipTrack } = useSocket();
  const {
    playlist, offlineBuffer, currentIndex, isOnline, pendingPlaylist, deviceId,
    sdkIsPaused, sdkPositionMs, sdkDurationMs, sdkCurrentTrackUri, sdkCurrentTrackImage,
  } = useSelector((s: RootState) => s.player);
  const heartRate = useSelector((s: RootState) => s.biometrics.heartRate);
  const taps = useSelector((s: RootState) => s.emotion.taps);

  // Local scrub state: while the user is dragging, the thumb follows their finger
  // and SDK position ticks are ignored, so the 1s progress interval and
  // player_state_changed events don't fight the drag.
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubPct, setScrubPct] = useState(0);

  // A track change mid-drag would otherwise commit a seek against the wrong track.
  useEffect(() => { setScrubbing(false); }, [sdkCurrentTrackUri]);

  // Like (Bug 7) + nav debounce (Bug 2/5) state. These hooks MUST sit above the
  // early `if (!track) return` below so the hook order is stable across renders.
  const [liked, setLiked] = useState(false);
  const likeLockRef = useRef(false);
  const navLockRef = useRef(0);

  const list = isOnline ? playlist : offlineBuffer;
  const track = list[currentIndex];
  const trackId = track?.id ?? null;
  const moodLabel = MOODS.find((m) => m.key === selectedMoodKey(taps))?.label;

  // Hydrate the heart state from Spotify whenever the current track changes.
  useEffect(() => {
    if (!trackId) { setLiked(false); return; }
    let cancelled = false;
    fetchTracksSaved(BACKEND_URL, [trackId])
      .then((m) => { if (!cancelled) setLiked(Boolean(m[trackId])); })
      .catch(() => { /* non-fatal — heart just stays un-filled */ });
    return () => { cancelled = true; };
  }, [trackId]);

  if (!track) {
    return (
      <>
        <PageHeader title="Now Playing" back />
        <EmptyState
          icon={Disc3}
          title="Nothing playing yet"
          description="Pick a mood on your dashboard and generate a session to start listening."
          actionLabel="Go to dashboard"
          actionTo="/app"
        />
      </>
    );
  }

  const canSeek = sdkDurationMs > 0;
  const pct = canSeek ? (sdkPositionMs / sdkDurationMs) * 100 : 0;
  const sliderPct = scrubbing ? scrubPct : pct;
  const displayMs = scrubbing ? (scrubPct / 100) * sdkDurationMs : sdkPositionMs;
  // Bug 9: show the ENTIRE remaining queue (was capped at 7), made scrollable below
  // so every generated track is reachable instead of being silently truncated.
  const upNext = list.slice(currentIndex + 1);

  const onScrub = ([v]: number[]) => {
    if (!canSeek) return;
    setScrubbing(true);
    setScrubPct(v);
  };
  const onScrubCommit = ([v]: number[]) => {
    if (!canSeek) return;
    const ms = Math.round((v / 100) * sdkDurationMs);
    spotifyPlayerService.seek(ms).catch(console.error);
    dispatch(setSdkState({ positionMs: ms })); // optimistic — resyncs on next SDK tick
    setScrubbing(false);
  };

  const toggle = () => {
    if (sdkIsPaused) spotifyPlayerService.resume().catch(console.error);
    else spotifyPlayerService.pause().catch(console.error);
  };
  // Navigation debounce: rapid Prev/Next mashing fires a flood of async SDK calls
  // whose player_state_changed events can arrive out of order. We DON'T optimistically
  // move currentIndex anymore — it follows the SDK's reported track (single source of
  // truth, see playerSlice) — but we still throttle the button so one press = one move.
  const navAllowed = () => {
    const now = Date.now();
    if (now - navLockRef.current < 250) return false;
    navLockRef.current = now;
    return true;
  };
  const handleSkip = () => {
    if (!navAllowed()) return;
    spotifyPlayerService.nextTrack().catch(console.error);
    skipTrack();
  };
  const handlePrev = () => {
    if (!navAllowed()) return;
    spotifyPlayerService.previousTrack().catch(console.error);
  };

  // Jump to any track in the queue. Online: play from that track onward so the
  // queue continues naturally; the SDK's reported uri re-snaps currentIndex (single
  // source of truth). Offline: play the buffered track directly and set the index.
  const handlePlayAt = (index: number) => {
    const target = list[index];
    if (!target?.uri) return;
    if (!isOnline) {
      audioPlayer.play(target.uri).catch(console.error);
      dispatch(setCurrentIndex(index));
      return;
    }
    const uris = sanitizeTrackUris(list.slice(index).map((t) => t.uri));
    if (uris.length === 0) { toast.error('This track can’t be played on Spotify.'); return; }
    playTracks(BACKEND_URL, uris, deviceId).catch((err) => {
      if (err.reconnect) reconnectToast('Reconnect Spotify to play tracks');
      else if (err.noActiveDevice) {
        toast.error('Open Spotify and start playback on a device, then try again.', {
          action: { label: 'Open Spotify', onClick: () => window.open('https://open.spotify.com', '_blank') },
        });
      } else toast.error('Could not start playback — please try again.');
    });
  };

  // Like / unlike the current track (Bug 7). Optimistic with revert-on-error, and
  // a re-entrancy lock so a rapid double-tap can't fire conflicting save/remove calls.
  const toggleLike = async () => {
    if (!trackId || likeLockRef.current) return;
    likeLockRef.current = true;
    const next = !liked;
    setLiked(next);
    try {
      await setTrackSaved(BACKEND_URL, trackId, next);
    } catch (err) {
      setLiked(!next); // revert
      if ((err as { reconnect?: boolean }).reconnect) reconnectToast('Reconnect Spotify to save songs');
      else toast.error('Could not update your library — try again.');
    } finally {
      likeLockRef.current = false;
    }
  };

  // Export the current session as a new Spotify playlist (Bug 6).
  const handleExport = () => {
    const uris = sanitizeTrackUris(list.map((t) => t.uri));
    if (uris.length === 0) { toast.error('No Spotify tracks to export.'); return; }
    exportPlaylist(BACKEND_URL, uris, `Kokonada — ${new Date().toLocaleDateString()}`)
      .then((r) => toast.success('Saved to Spotify ✓', {
        action: r.url ? { label: 'Open', onClick: () => window.open(r.url, '_blank') } : undefined,
      }))
      .catch((err) => {
        if (err.reconnect) reconnectToast('Reconnect Spotify to save playlists');
        else toast.error('Could not save to Spotify — please try again.');
      });
  };

  return (
    <>
      <PageHeader title="Now Playing" back />

      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        {/* Art: real Spotify cover when available (Bug 4), else the aura blob */}
        {sdkCurrentTrackImage ? (
          <img
            src={sdkCurrentTrackImage}
            alt="Album art"
            className="aspect-square w-full max-w-xs rounded-[2rem] object-cover shadow-2xl"
          />
        ) : (
          <div className="grid aspect-square w-full max-w-xs place-items-center rounded-[2rem] bg-linear-to-br from-(--aura-a) to-(--aura-b) shadow-2xl">
            <Disc3 className="size-16 text-white/70" />
          </div>
        )}

        {/* Meta */}
        <div className="mt-7 flex w-full items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-2xl font-semibold tracking-tight text-foreground">
              {track.title}
            </h2>
            <p className="truncate text-muted-foreground">{track.artist}</p>
          </div>
          <button
            onClick={toggleLike}
            aria-label={liked ? 'Unlike' : 'Like'}
            aria-pressed={liked}
            className={`grid size-11 shrink-0 place-items-center rounded-full transition-colors hover:bg-muted ${
              liked ? 'text-coral' : 'text-muted-foreground hover:text-coral'
            }`}
          >
            <Heart className={liked ? 'size-5 fill-current' : 'size-5'} />
          </button>
        </div>

        {/* Spotify attribution (Design Guidelines): link the playing track back to Spotify. */}
        {track.uri?.startsWith('spotify:track:') && (
          <a
            href={`https://open.spotify.com/track/${track.uri.split(':')[2]}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 self-start text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <SpotifyLogo className="size-4" /> Listen on Spotify
          </a>
        )}

        <div className="mt-3 flex w-full flex-wrap gap-2">
          {moodLabel && <Badge variant="secondary">{moodLabel}</Badge>}
          {heartRate !== null && (
            <Badge variant="outline" className="font-mono">♥ {heartRate} BPM</Badge>
          )}
          {!isOnline && <Badge variant="outline">Offline</Badge>}
        </div>

        {/* Progress / seek */}
        <div className="mt-6 w-full">
          <Slider
            value={[sliderPct]}
            max={100}
            step={0.1}
            aria-label="Seek"
            disabled={!canSeek}
            onValueChange={onScrub}
            onValueCommit={onScrubCommit}
            className={canSeek ? 'cursor-pointer' : 'pointer-events-none opacity-50'}
          />
          <div className="mt-2 flex justify-between font-mono text-xs text-muted-foreground">
            <span>{fmt(displayMs)}</span>
            <span>{canSeek ? fmt(sdkDurationMs) : '--:--'}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-6 flex items-center gap-8">
          <button
            onClick={handlePrev}
            aria-label="Previous"
            disabled={currentIndex === 0}
            className="grid size-12 place-items-center rounded-full text-foreground transition-colors hover:bg-muted disabled:opacity-30"
          >
            <SkipBack className="size-6" />
          </button>
          <button
            onClick={toggle}
            aria-label={sdkIsPaused ? 'Play' : 'Pause'}
            className="grid size-16 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
          >
            {sdkIsPaused ? <Play className="size-7 translate-x-0.5" /> : <Pause className="size-7" />}
          </button>
          <button
            onClick={handleSkip}
            aria-label="Skip"
            disabled={currentIndex + 1 >= list.length}
            className="grid size-12 place-items-center rounded-full text-foreground transition-colors hover:bg-muted disabled:opacity-30"
          >
            <SkipForward className="size-6" />
          </button>
        </div>

        {/* Export the whole session to the user's real Spotify account (Bug 6) */}
        <button
          onClick={handleExport}
          aria-label="Save to Spotify"
          className="mt-6 flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <SpotifyLogo className="size-4" /> Save to Spotify
        </button>

        {/* Queue */}
        {pendingPlaylist.length > 0 && (
          <p className="mb-3 flex items-center gap-1 text-xs text-coral">
            <Heart className="size-3" /> New heart-rate mix queued — starts after this track
          </p>
        )}
        {upNext.length > 0 && (
          <div className="mt-10 w-full">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Up next <span className="text-muted-foreground/60">· {upNext.length}</span>
            </h3>
            <ul className="flex max-h-[50vh] flex-col overflow-y-auto">
              {upNext.map((t, i) => (
                <li key={t.id} className="border-b border-border/60 last:border-none">
                  <button
                    type="button"
                    onClick={() => handlePlayAt(currentIndex + 1 + i)}
                    aria-label={`Play ${t.title} by ${t.artist}`}
                    className="flex w-full items-center gap-3 rounded-md py-2.5 text-left transition-colors hover:bg-muted"
                  >
                    <span className="w-4 shrink-0 text-center font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.title}</span>
                    <span className="shrink-0 truncate text-xs text-muted-foreground">{t.artist}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
