import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Check, Plus, Settings, LogOut, Sparkles } from 'lucide-react';
import type { AppDispatch, RootState } from '@/store';
import { clearUser, setAuthStatus } from '@/store/slices/authSlice';
import { getSessions } from '@/lib/history';
import { authHeaders, clearToken } from '@/lib/api';
import PageHeader from '@/components/PageHeader';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

function ServiceLine({ name, connected }: { name: string; connected: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-foreground">{name}</span>
      {connected ? (
        <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
          <Check className="size-4" /> Connected
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">Not connected</span>
      )}
    </div>
  );
}

export default function UserProfilePage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const user = useSelector((s: RootState) => s.auth.user);
  const { musicProvider, biometricProvider } = useSelector((s: RootState) => s.integrations);

  const stats = useMemo(() => {
    const sessions = getSessions();
    const counts = new Map<string, number>();
    let tracks = 0;
    for (const s of sessions) {
      tracks += s.tracks.length;
      counts.set(s.moodLabel, (counts.get(s.moodLabel) ?? 0) + 1);
    }
    let topMood = '—';
    let max = 0;
    for (const [label, n] of counts) if (n > max) { max = n; topMood = label; }
    // rough listen estimate: ~3.5 min per track
    const hours = Math.max(0, Math.round((tracks * 3.5) / 60));
    return { playlists: sessions.length, hours, topMood };
  }, []);

  const handleLogout = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
      });
    } catch {
      /* network failure — still clear client-side auth so the user is never stuck */
    } finally {
      clearToken();
      dispatch(clearUser());
      dispatch(setAuthStatus('idle'));
    }
  };

  const initials = (user?.displayName ?? 'K').slice(0, 2).toUpperCase();

  return (
    <>
      <PageHeader
        title="Profile"
        action={
          <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => navigate('/settings')}>
            <Settings className="size-5" />
          </Button>
        }
      />

      <div className="flex flex-col items-center text-center">
        <Avatar className="size-20">
          {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.displayName} />}
          <AvatarFallback className="bg-linear-to-br from-emotion-focus to-emotion-unwind text-lg text-primary-foreground">
            {initials}
          </AvatarFallback>
        </Avatar>
        <h2 className="mt-3 font-display text-xl font-semibold text-foreground">{user?.displayName ?? 'Listener'}</h2>
        {user?.email && <p className="text-sm text-muted-foreground">{user.email}</p>}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {[
          { label: 'Playlists', value: stats.playlists },
          { label: 'Hours', value: `${stats.hours}h` },
          { label: 'Top mood', value: stats.topMood },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl bg-card p-4 text-center ring-1 ring-foreground/10">
            <p className="truncate font-display text-xl font-semibold text-foreground">{s.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <section className="mt-8">
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Connected services</h3>
        <div className="divide-y divide-border rounded-2xl bg-card px-4 ring-1 ring-foreground/10">
          <ServiceLine name="Spotify" connected={musicProvider === 'spotify'} />
          <ServiceLine name="YouTube Music" connected={musicProvider === 'youtube'} />
          <ServiceLine name="Garmin" connected={biometricProvider === 'garmin'} />
          <ServiceLine name="Apple Health" connected={biometricProvider === 'applehealth'} />
        </div>
        <button
          onClick={() => navigate('/integrations')}
          className="mt-2 flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <Plus className="size-4" /> Manage connections
        </button>
      </section>

      <section className="mt-8">
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Account</h3>
        <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Kokonada Free</p>
              <p className="text-xs text-muted-foreground">Unlimited mood sessions</p>
            </div>
            <Button size="sm" className="gap-1.5 rounded-full">
              <Sparkles className="size-3.5" /> Upgrade
            </Button>
          </div>
          <Separator className="my-3" />
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm font-medium text-destructive hover:underline"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      </section>
    </>
  );
}
