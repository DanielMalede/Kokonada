import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Music, HeartPulse, Disc3, Check } from 'lucide-react';
import type { AppDispatch, RootState } from '../store';
import {
  setMusicProvider,
  setBiometricProvider,
  setMoodOnly,
  selectIsIntegrationsComplete,
} from '../store/slices/integrationsSlice';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { toast } from 'sonner';
import { authHeaders, buildConnectUrl } from '@/lib/api';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

// Map a callback ?error= code (emitted by the backend OAuth callbacks) to a
// user-facing message. Codes look like `spotify_access_denied`, `youtube_state`,
// `garmin_expired`, `garmin_denied`, `<provider>_failed`, or `session`.
function friendlyConnectError(code: string): string {
  if (code.endsWith('access_denied') || code === 'garmin_denied') return 'Connection cancelled.';
  if (code === 'garmin_expired' || code.endsWith('_state') || code === 'garmin_mismatch')
    return 'That connection link expired — please try again.';
  if (code === 'session') return 'Your session expired — please sign in again.';
  const provider = code.split('_')[0];
  const name =
    provider === 'spotify' ? 'Spotify' :
    provider === 'youtube' ? 'YouTube Music' :
    provider === 'garmin'  ? 'Garmin' : 'the service';
  if (code.endsWith('_unconfigured')) return `${name} isn't available yet — check back soon.`;
  return `Couldn't connect ${name}. Please try again.`;
}

interface RowProps {
  name: string;
  hint?: string;
  connected: boolean;
  disabled?: boolean;
  onConnect?: () => void;
}

function ServiceRow({ name, hint, connected, disabled, onConnect }: RowProps) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{name}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {connected ? (
        <Badge className="gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Check className="size-3" /> Connected
        </Badge>
      ) : (
        <Switch
          checked={false}
          disabled={disabled}
          onCheckedChange={(on) => on && onConnect?.()}
          aria-label={`Connect ${name}`}
        />
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const music = useSelector((s: RootState) => s.integrations.musicProvider);
  const biometric = useSelector((s: RootState) => s.integrations.biometricProvider);
  const moodOnly = useSelector((s: RootState) => s.integrations.moodOnly);
  const complete = useSelector(selectIsIntegrationsComplete);

  // Hydrate from backend on mount (handles hard refresh)
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/integrations/status`, { credentials: 'include', headers: authHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        dispatch(setMusicProvider(data.musicProvider));
        dispatch(setBiometricProvider(data.biometricProvider));
      })
      .catch(() => {});
  }, [dispatch]);

  // Read OAuth return params (?music=spotify, ?biometric=garmin, or ?error=<code>)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const musicParam = params.get('music') as 'spotify' | 'youtube' | null;
    const biometricParam = params.get('biometric') as 'garmin' | 'applehealth' | null;
    const errorParam = params.get('error');
    if (musicParam === 'spotify' || musicParam === 'youtube') dispatch(setMusicProvider(musicParam));
    if (biometricParam === 'garmin' || biometricParam === 'applehealth') dispatch(setBiometricProvider(biometricParam));
    if (errorParam) toast.error(friendlyConnectError(errorParam));
    if (musicParam || biometricParam || errorParam) window.history.replaceState({}, '', '/integrations');
  }, [dispatch]);

  // A short-lived single-use connect token authenticates the top-level navigation
  // (no headers possible). See buildConnectUrl — the session JWT never enters the URL.
  const connectSpotify = async () => { window.location.href = await buildConnectUrl(BACKEND_URL, '/api/integrations/spotify/connect'); };
  const connectYouTube = async () => { window.location.href = await buildConnectUrl(BACKEND_URL, '/api/integrations/youtube/connect'); };
  const connectGarmin = async () => { window.location.href = await buildConnectUrl(BACKEND_URL, '/api/integrations/garmin/connect'); };

  const enableMoodOnly = () => {
    localStorage.setItem('koko-mood-only', '1');
    dispatch(setMoodOnly(true));
  };

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-5 py-10">
      <div className="emotion-aura" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-linear-to-br from-emotion-focus to-emotion-unwind text-primary-foreground shadow-lg">
            <Disc3 className="size-6" />
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Connect your services
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a music source — add a wearable for biometric magic, or start with mood only.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {/* Music */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Music className="size-4 text-primary" /> Music source
                <span className="ml-auto text-xs font-normal text-muted-foreground">Required</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              <ServiceRow name="Spotify" connected={music === 'spotify'} onConnect={connectSpotify} />
              <ServiceRow name="YouTube Music" connected={music === 'youtube'} onConnect={connectYouTube} />
            </CardContent>
          </Card>

          {/* Biometric */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <HeartPulse className="size-4 text-coral" /> Biometric data
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {moodOnly ? 'Skipped' : 'Optional'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              <ServiceRow name="Garmin" connected={biometric === 'garmin'} onConnect={connectGarmin} />
              <ServiceRow name="Apple Health" hint="Available in the iOS app" connected={biometric === 'applehealth'} disabled />
              {!biometric && !moodOnly && (
                <button
                  onClick={enableMoodOnly}
                  className="w-full pt-3 text-left text-sm font-medium text-primary hover:underline"
                >
                  Skip — try with mood only →
                </button>
              )}
              {moodOnly && (
                <p className="pt-3 text-sm text-muted-foreground">
                  Mood-only mode on. Connect a wearable any time from Settings to unlock live heart-rate tuning.
                </p>
              )}
            </CardContent>
          </Card>

          <Accordion type="single" collapsible>
            <AccordionItem value="why" className="border-none">
              <AccordionTrigger className="text-sm text-muted-foreground">
                Why does Kokonada want my heart rate?
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                Your heart rate and activity tell us your real-time energy. We blend that with the
                mood you pick to curate music that fits the exact moment — and re-tune it live as
                your body changes. Your data stays private and is never sold.
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <Button
            onClick={() => navigate('/app')}
            disabled={!complete}
            className="h-12 rounded-full text-base"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
