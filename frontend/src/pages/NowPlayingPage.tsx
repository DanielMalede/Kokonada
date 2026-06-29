import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Play, Pause, SkipForward, Disc3, Heart } from 'lucide-react';
import type { AppDispatch, RootState } from '@/store';
import { skipTrack as skipTrackAction, setSdkState } from '@/store/slices/playerSlice';
import { spotifyPlayerService } from '@/services/spotifyPlayer';
import { useSocket } from '@/hooks/useSocket';
import { MOODS, selectedMoodKey } from '@/lib/moods';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';

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
    playlist, offlineBuffer, currentIndex, isOnline, pendingPlaylist,
    sdkIsPaused, sdkPositionMs, sdkDurationMs, sdkCurrentTrackUri,
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

  const list = isOnline ? playlist : offlineBuffer;
  const track = list[currentIndex];
  const moodLabel = MOODS.find((m) => m.key === selectedMoodKey(taps))?.label;

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
  const upNext = list.slice(currentIndex + 1, currentIndex + 8);

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
  const handleSkip = () => {
    spotifyPlayerService.nextTrack().catch(console.error);
    dispatch(skipTrackAction());
    skipTrack();
  };

  return (
    <>
      <PageHeader title="Now Playing" back />

      <div className="mx-auto flex w-full max-w-md flex-col items-center">
        {/* Art / aura blob */}
        <div className="grid aspect-square w-full max-w-xs place-items-center rounded-[2rem] bg-linear-to-br from-(--aura-a) to-(--aura-b) shadow-2xl">
          <Disc3 className="size-16 text-white/70" />
        </div>

        {/* Meta */}
        <div className="mt-7 flex w-full items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-2xl font-semibold tracking-tight text-foreground">
              {track.title}
            </h2>
            <p className="truncate text-muted-foreground">{track.artist}</p>
          </div>
          <button
            aria-label="Like"
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-coral"
          >
            <Heart className="size-5" />
          </button>
        </div>

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

        {/* Queue */}
        {pendingPlaylist.length > 0 && (
          <p className="mb-3 flex items-center gap-1 text-xs text-coral">
            <Heart className="size-3" /> New heart-rate mix queued — starts after this track
          </p>
        )}
        {upNext.length > 0 && (
          <div className="mt-10 w-full">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Up next</h3>
            <ul className="flex flex-col">
              {upNext.map((t, i) => (
                <li key={t.id} className="flex items-center gap-3 border-b border-border/60 py-2.5 last:border-none">
                  <span className="w-4 shrink-0 text-center font-mono text-xs text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.title}</span>
                  <span className="shrink-0 truncate text-xs text-muted-foreground">{t.artist}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
