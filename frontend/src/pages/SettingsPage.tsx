import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'sonner';
import type { AppDispatch, RootState } from '@/store';
import { setMusicProvider, setBiometricProvider } from '@/store/slices/integrationsSlice';
import { authHeaders } from '@/lib/api';
import { useConnections } from '@/hooks/useConnections';
import DisconnectButton from '@/components/DisconnectButton';
import PageHeader from '@/components/PageHeader';
import ThemeToggle from '@/components/ThemeToggle';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

function readBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v === '1';
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="rounded-2xl bg-card px-4 ring-1 ring-foreground/10">{children}</div>
    </section>
  );
}

function Row({ label, hint, control }: { label: string; hint?: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3.5 last:border-none">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export default function SettingsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const music = useSelector((s: RootState) => s.integrations.musicProvider);
  const biometric = useSelector((s: RootState) => s.integrations.biometricProvider);
  const { signOut } = useConnections();

  // Hydrate connection state on mount so Settings reflects reality even when
  // opened directly (not via the Integrations page).
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/integrations/status`, { credentials: 'include', headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        dispatch(setMusicProvider(data.musicProvider));
        dispatch(setBiometricProvider(data.biometricProvider));
      })
      .catch(() => {});
  }, [dispatch]);

  const [aura, setAura] = useState(() => readBool('koko-aura', true));
  const [notifReady, setNotifReady] = useState(() => readBool('koko-notif-ready', true));
  const [notifRecal, setNotifRecal] = useState(() => readBool('koko-notif-recal', false));
  const [sensitivity, setSensitivity] = useState<number>(() =>
    Number(localStorage.getItem('koko-recal-sensitivity') ?? '50'),
  );

  // Apply the aura preference globally via a root class.
  useEffect(() => {
    document.documentElement.classList.toggle('aura-off', !aura);
    localStorage.setItem('koko-aura', aura ? '1' : '0');
  }, [aura]);

  const persist = (key: string, on: boolean) => localStorage.setItem(key, on ? '1' : '0');
  const sensitivityLabel = sensitivity < 34 ? 'Low' : sensitivity < 67 ? 'Medium' : 'High';

  const deleteData = () => {
    localStorage.removeItem('koko-history');
    toast.success('Your session history was deleted.');
  };

  return (
    <>
      <PageHeader title="Settings" back />

      <Section title="Appearance">
        <div className="border-b border-border/60 py-3.5">
          <p className="mb-2.5 text-sm font-medium text-foreground">Theme</p>
          <ThemeToggle />
        </div>
        <Row
          label="Emotion Aura"
          hint="Ambient color that shifts with your mood"
          control={<Switch checked={aura} onCheckedChange={setAura} aria-label="Emotion Aura" />}
        />
      </Section>

      <Section title="Notifications">
        <Row
          label="Playlist ready"
          control={
            <Switch
              checked={notifReady}
              onCheckedChange={(v) => { setNotifReady(v); persist('koko-notif-ready', v); }}
              aria-label="Playlist ready notifications"
            />
          }
        />
        <Row
          label="Recalibration alerts"
          control={
            <Switch
              checked={notifRecal}
              onCheckedChange={(v) => { setNotifRecal(v); persist('koko-notif-recal', v); }}
              aria-label="Recalibration alerts"
            />
          }
        />
      </Section>

      <Section title="Biometric">
        <div className="py-3.5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Recalibration sensitivity</p>
            <span className="text-sm text-muted-foreground">{sensitivityLabel}</span>
          </div>
          <Slider
            value={[sensitivity]}
            max={100}
            step={1}
            onValueChange={([v]) => setSensitivity(v)}
            onValueCommit={([v]) => localStorage.setItem('koko-recal-sensitivity', String(v))}
            aria-label="Recalibration sensitivity"
          />
        </div>
      </Section>

      <Section title="Connections">
        {!music && biometric !== 'garmin' ? (
          <Row
            label="No services connected"
            hint="Link Spotify, YouTube Music, or a wearable"
            control={
              <Link to="/integrations" className="text-sm font-medium text-primary hover:underline">
                Connect →
              </Link>
            }
          />
        ) : (
          <>
            {music && (
              <Row
                label={music === 'spotify' ? 'Spotify' : 'YouTube Music'}
                hint="Music source"
                control={<DisconnectButton kind={music === 'spotify' ? 'spotify' : 'youtube'} />}
              />
            )}
            {biometric === 'garmin' && (
              <Row label="Garmin" hint="Wearable" control={<DisconnectButton kind="garmin" />} />
            )}
          </>
        )}
      </Section>

      <Section title="Data & privacy">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="w-full border-b border-border/60 py-3.5 text-left text-sm font-medium text-destructive">
              Delete my session history
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete session history?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes every saved playlist from this device. This can’t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={deleteData}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Row label="Privacy Policy" control={<span className="text-muted-foreground">→</span>} />
        <Row label="Terms of Service" control={<span className="text-muted-foreground">→</span>} />
      </Section>

      <Section title="Account">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className="w-full py-3.5 text-left text-sm font-medium text-destructive">
              Log out
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Log out of Kokonada?</AlertDialogTitle>
              <AlertDialogDescription>
                You’ll need to sign in again to generate playlists. Your connected services stay linked.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { void signOut(); }}>Log out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>

      <Separator className="my-6" />
      <p className="pb-2 text-center text-xs text-muted-foreground">Kokonada · v1.0</p>
    </>
  );
}
