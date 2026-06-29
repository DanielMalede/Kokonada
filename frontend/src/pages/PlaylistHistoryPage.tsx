import { useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { ListMusic, Play, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AppDispatch } from '@/store';
import { setPlaylist, setPlaybackMode } from '@/store/slices/playerSlice';
import { getSessions, deleteSession, deleteSessions, type Session } from '@/lib/history';
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
  const [sessions, setSessions] = useState<Session[]>(() => getSessions());
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const refresh = () => setSessions(getSessions());

  const removeOne = (s: Session) => {
    deleteSession(s.id);
    refresh();
    toast.success('Session deleted');
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };

  const bulkDelete = () => {
    const n = selected.size;
    if (n === 0) return;
    deleteSessions([...selected]);
    exitSelect();
    refresh();
    toast.success(`${n} session${n > 1 ? 's' : ''} deleted`);
  };

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
        <div className="flex flex-col gap-5">
          {/* Manage controls: enter multi-select, then bulk-delete the picked sessions. */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{sessions.length} session{sessions.length > 1 ? 's' : ''}</span>
            {selectMode ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={bulkDelete}
                  disabled={selected.size === 0}
                  className="flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-opacity disabled:opacity-40"
                >
                  <Trash2 className="size-4" /> Delete selected ({selected.size})
                </button>
                <button onClick={exitSelect} className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setSelectMode(true)}
                className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Select
              </button>
            )}
          </div>

          {groups.map(([label, items]) => (
            <section key={label} className="flex flex-col gap-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h2>
              <ul className="flex flex-col gap-2.5">
                {items.map((s) => {
                  const c = moodColors(s.moodKey);
                  return (
                    <li key={s.id}>
                      <div className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-foreground/10">
                        {selectMode && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${s.moodLabel} session`}
                            checked={selected.has(s.id)}
                            onChange={() => toggleSelected(s.id)}
                            className="size-5 shrink-0 accent-primary"
                          />
                        )}
                        <button
                          onClick={() => (selectMode ? toggleSelected(s.id) : navigate(`/history/${s.id}`))}
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
                        {!selectMode && (
                          <>
                            <button
                              onClick={() => play(s)}
                              aria-label={`Play ${s.moodLabel} session`}
                              className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
                            >
                              <Play className="size-4 translate-x-px" />
                            </button>
                            <button
                              onClick={() => removeOne(s)}
                              aria-label={`Delete ${s.moodLabel} session`}
                              className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </>
                        )}
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
