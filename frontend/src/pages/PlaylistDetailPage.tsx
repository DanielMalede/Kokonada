import { useDispatch } from 'react-redux';
import { useNavigate, useParams } from 'react-router-dom';
import { Play, HeartPulse, ListMusic } from 'lucide-react';
import type { AppDispatch } from '@/store';
import { setPlaylist, setPlaybackMode } from '@/store/slices/playerSlice';
import { getSession } from '@/lib/history';
import { MOODS } from '@/lib/moods';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function PlaylistDetailPage() {
  const { id } = useParams();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const session = id ? getSession(id) : undefined;

  if (!session) {
    return (
      <>
        <PageHeader title="Session" back />
        <EmptyState
          icon={ListMusic}
          title="Session not found"
          description="This playlist may have been cleared from your history."
          actionLabel="Back to history"
          actionTo="/history"
        />
      </>
    );
  }

  const mood = MOODS.find((m) => m.key === session.moodKey);
  const a = mood?.auraA ?? 'var(--emotion-neutral)';
  const b = mood?.auraB ?? 'var(--emotion-focus)';
  const date = new Date(session.createdAt).toLocaleString(undefined, {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });

  const playAll = () => {
    dispatch(setPlaylist({ tracks: session.tracks, trigger: 'emotion' }));
    dispatch(setPlaybackMode('live'));
    navigate('/now-playing');
  };

  return (
    <>
      <PageHeader title={session.moodLabel} subtitle={date} back />

      <div
        className="mb-5 flex h-40 items-end rounded-3xl p-5 text-white"
        style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
      >
        <div>
          <p className="font-display text-2xl font-semibold">{session.moodLabel}</p>
          <p className="text-sm text-white/80">{session.tracks.length} tracks</p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {session.heartRate !== null && (
          <Badge variant="outline" className="gap-1 font-mono">
            <HeartPulse className="size-3" /> {session.heartRate} BPM
          </Badge>
        )}
        {session.activity && <Badge variant="secondary">{session.activity}</Badge>}
        <Badge variant="secondary">{session.mode === 'live' ? 'Streamed live' : 'Saved to library'}</Badge>
      </div>

      {session.textPrompt && (
        <p className="mb-5 rounded-xl bg-muted/60 px-4 py-3 text-sm italic text-muted-foreground">
          “{session.textPrompt}”
        </p>
      )}

      <Button onClick={playAll} className="mb-6 h-11 w-full rounded-full text-base">
        <Play className="size-4 translate-x-px" /> Play all
      </Button>

      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {session.tracks.length} tracks
      </h3>
      <ul className="flex flex-col">
        {session.tracks.map((t, i) => (
          <li key={t.id} className="flex items-center gap-3 border-b border-border/60 py-3 last:border-none">
            <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.title}</span>
            <span className="shrink-0 truncate text-xs text-muted-foreground">{t.artist}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
