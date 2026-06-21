import { useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { ListMusic, Play } from 'lucide-react';
import type { AppDispatch } from '@/store';
import { setPlaylist, setPlaybackMode } from '@/store/slices/playerSlice';
import { getSessions, type Session } from '@/lib/history';
import { MOODS } from '@/lib/moods';
import PageHeader from '@/components/PageHeader';
import EmptyState from '@/components/EmptyState';

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function moodColors(key: string | null) {
  const mood = MOODS.find((m) => m.key === key);
  return { a: mood?.auraA ?? 'var(--emotion-neutral)', b: mood?.auraB ?? 'var(--emotion-focus)' };
}

export default function PlaylistHistoryPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [sessions] = useState<Session[]>(() => getSessions());

  const groups = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      const label = dayLabel(s.createdAt);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(s);
    }
    return Array.from(map.entries());
  }, [sessions]);

  const play = (s: Session) => {
    dispatch(setPlaylist({ tracks: s.tracks, trigger: 'emotion' }));
    dispatch(setPlaybackMode('live'));
    navigate('/now-playing');
  };

  return (
    <>
      <PageHeader title="History" />

      {sessions.length === 0 ? (
        <EmptyState
          icon={ListMusic}
          title="No sessions yet"
          description="Every playlist you generate is saved here so you can replay it any time."
          actionLabel="Create your first session"
          actionTo="/app"
        />
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map(([label, items]) => (
            <section key={label} className="flex flex-col gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h2>
              <ul className="flex flex-col gap-2.5">
                {items.map((s) => {
                  const c = moodColors(s.moodKey);
                  return (
                    <li key={s.id}>
                      <div className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-foreground/10">
                        <button
                          onClick={() => navigate(`/history/${s.id}`)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span
                            className="grid size-14 shrink-0 place-items-center rounded-xl text-white/80"
                            style={{ background: `linear-gradient(135deg, ${c.a}, ${c.b})` }}
                          >
                            <ListMusic className="size-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{s.moodLabel}</span>
                            <span className="block truncate text-sm text-muted-foreground">
                              {timeLabel(s.createdAt)} · {s.tracks.length} tracks
                            </span>
                          </span>
                        </button>
                        <button
                          onClick={() => play(s)}
                          aria-label={`Play ${s.moodLabel} session`}
                          className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
                        >
                          <Play className="size-4 translate-x-px" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
