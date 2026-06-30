import { useEffect, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Sparkles, Headphones, Save, ListMusic, HeartPulse } from 'lucide-react';
import type { RootState, AppDispatch } from '../store';
import { setTextPrompt } from '../store/slices/emotionSlice';
import { setPlaybackMode } from '../store/slices/playerSlice';
import { useSocket } from '../hooks/useSocket';
import { MOODS, selectedMoodKey } from '@/lib/moods';
import { saveSession, makeSessionId } from '@/lib/history';
import MoodChips from '@/components/MoodChips';
import HRZoneBar from '@/components/HRZoneBar';
import OfflineBanner from '@/components/OfflineBanner';
import GeneratingOverlay from '@/components/GeneratingOverlay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Mode = 'live' | 'export';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function AppPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const taps = useSelector((s: RootState) => s.emotion.taps);
  const textPrompt = useSelector((s: RootState) => s.emotion.textPrompt);
  const { playlist, offlineBuffer, currentIndex, isOnline } = useSelector((s: RootState) => s.player);
  const heartRate = useSelector((s: RootState) => s.biometrics.heartRate);
  const activity = useSelector((s: RootState) => s.biometrics.activity);
  const lastErrorAt = useSelector((s: RootState) => s.player.lastErrorAt);
  const { requestPlaylist, requestHeartPlaylist } = useSocket();

  const [modeOpen, setModeOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const modeRef = useRef<Mode>('live');
  const lastKeyRef = useRef<string>('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{
    moodKey: string | null;
    moodLabel: string;
    textPrompt: string;
    mode: Mode;
    heartRate: number | null;
    activity: string | null;
  } | null>(null);

  const moodKey = selectedMoodKey(taps);
  const moodLabel = MOODS.find((m) => m.key === moodKey)?.label;
  const hasMood = taps.length > 0;

  const list = isOnline ? playlist : offlineBuffer;
  const upNext = list.slice(currentIndex + 1, currentIndex + 5);

  // Safety timeout for the generating overlay. Backend generation (Groq + the vibe
  // critic + Spotify discovery) can take ~7-14s — the old 9s timeout fired BEFORE the
  // result arrived, clearing the overlay silently AND (because the success effect was
  // gated on `generating`) dropping the late playlist with no toast/navigation. Now we
  // wait 25s and, if nothing arrives, toast instead of failing silently.
  const GENERATION_TIMEOUT_MS = 25_000;
  const armGenerationTimeout = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setGenerating(false);
      pendingRef.current = null;
      toast.error('Generation timed out — please try again.');
    }, GENERATION_TIMEOUT_MS);
  };

  const chooseMode = (mode: Mode) => {
    if (generating) return; // race guard: ignore a second mode pick mid-generation
    modeRef.current = mode;
    setModeOpen(false);
    lastKeyRef.current = playlist.map((t) => t.uri).join(',');
    pendingRef.current = {
      moodKey,
      moodLabel: moodLabel ?? 'Session',
      textPrompt,
      mode,
      heartRate,
      activity,
    };
    requestPlaylist(taps, textPrompt, mode);
    dispatch(setPlaybackMode(mode));
    setGenerating(true);
    armGenerationTimeout();
  };

  // "Listen to your heart" — generate from heart rate alone (no mood required) and
  // stream it live. Backend uses the last 30 min of health data, else current HR.
  const listenToYourHeart = () => {
    if (generating) return;
    modeRef.current = 'live';
    lastKeyRef.current = playlist.map((t) => t.uri).join(',');
    pendingRef.current = {
      moodKey: null,
      moodLabel: 'Heartbeat',
      textPrompt: '',
      mode: 'live',
      heartRate,
      activity,
    };
    requestHeartPlaylist('live', heartRate);
    dispatch(setPlaybackMode('live'));
    setGenerating(true);
    armGenerationTimeout();
  };

  // Dismiss the overlay when a fresh playlist lands; record it to history and
  // jump into the player for live mode.
  // Gate on the IN-FLIGHT request (pendingRef), not `generating`, so a result that
  // arrives after the overlay timeout still gives feedback (navigation + toast)
  // instead of being silently dropped.
  useEffect(() => {
    if (!pendingRef.current) return;
    const key = playlist.map((t) => t.uri).join(',');
    if (playlist.length > 0 && key !== lastKeyRef.current) {
      setGenerating(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const p = pendingRef.current;
      if (p) {
        saveSession({
          id: makeSessionId(),
          createdAt: Date.now(),
          tracks: playlist,
          ...p,
        });
        pendingRef.current = null;
      }
      toast.success('Playlist ready ✓');
      if (modeRef.current === 'live') navigate('/now-playing');
    }
  }, [playlist, navigate]);

  // Generation failed / returned an empty payload (useSocket already toasted the
  // reason) — stop the overlay instead of spinning until the 9s timeout.
  const lastErrorRef = useRef(lastErrorAt);
  useEffect(() => {
    if (lastErrorAt !== lastErrorRef.current) {
      lastErrorRef.current = lastErrorAt;
      setGenerating(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      pendingRef.current = null;
    }
  }, [lastErrorAt]);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  return (
    <>
      <OfflineBanner />

      <div className="mb-6">
        <p className="text-sm text-muted-foreground">{greeting()},</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {user?.displayName ?? 'there'}
        </h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Mood + context */}
        <Card className="md:row-span-2">
          <CardHeader>
            <CardTitle>How do you want to feel?</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <MoodChips />
            <div className="flex flex-col gap-2">
              <label htmlFor="context" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Context <span className="normal-case opacity-70">(optional)</span>
              </label>
              <Textarea
                id="context"
                rows={3}
                placeholder="e.g. Deep work for the next hour"
                value={textPrompt}
                onChange={(e) => dispatch(setTextPrompt(e.target.value))}
                className="resize-none"
              />
            </div>
            <Button
              onClick={() => setModeOpen(true)}
              disabled={!hasMood || generating}
              className="h-12 rounded-full text-base"
              title={!hasMood ? 'Pick a mood first' : undefined}
            >
              <Sparkles className="size-4" />
              {generating ? 'Generating…' : 'Generate playlist'}
            </Button>
            {!hasMood && (
              <p className="-mt-2 text-center text-xs text-muted-foreground">
                Pick a mood to get started.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Biometrics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Your body right now</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <HRZoneBar />
            <Button
              onClick={listenToYourHeart}
              disabled={generating}
              variant="secondary"
              className="h-11 rounded-full"
            >
              <HeartPulse className="size-4" />
              {generating ? 'Generating…' : 'Listen to your heart'}
            </Button>
            <p className="-mt-1 text-center text-xs text-muted-foreground">
              No mood needed — a playlist tuned to your heart rate.
            </p>
          </CardContent>
        </Card>

        {/* Up next */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListMusic className="size-4 text-muted-foreground" /> Up next
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upNext.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Set a mood and hit generate to start a session.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {upNext.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => navigate('/now-playing')}
                      aria-label={`Open player — ${t.title} by ${t.artist}`}
                      className="flex w-full items-center gap-3 rounded-md py-1.5 text-left transition-colors hover:bg-muted"
                    >
                      <span className="size-1.5 shrink-0 rounded-full bg-primary/60" />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.title}</span>
                      <span className="shrink-0 truncate text-xs text-muted-foreground">{t.artist}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    onClick={() => navigate('/now-playing')}
                    className="mt-1 text-sm font-medium text-primary hover:underline"
                  >
                    Open player →
                  </button>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Playback mode chooser */}
      <Dialog open={modeOpen} onOpenChange={setModeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How should we play this?</DialogTitle>
            <DialogDescription>Choose how you want your {moodLabel?.toLowerCase()} session delivered.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <button
              onClick={() => chooseMode('live')}
              className="flex items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4 text-left transition-colors hover:bg-primary/10"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                <Headphones className="size-5" />
              </span>
              <span>
                <span className="block font-medium text-foreground">Listen live</span>
                <span className="block text-sm text-muted-foreground">Stream now with real-time biometric tuning</span>
              </span>
            </button>
            <button
              onClick={() => chooseMode('export')}
              className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-secondary-foreground">
                <Save className="size-5" />
              </span>
              <span>
                <span className="block font-medium text-foreground">Save to library</span>
                <span className="block text-sm text-muted-foreground">Export the playlist to your music account</span>
              </span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <GeneratingOverlay open={generating} moodLabel={moodLabel} />
    </>
  );
}
