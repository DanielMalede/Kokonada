import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Music, HeartPulse, Disc3, Check } from 'lucide-react';

declare const google: {
  accounts: {
    oauth2: {
      initCodeClient(cfg: {
        client_id: string;
        scope: string;
        ux_mode: 'popup' | 'redirect';
        callback: (response: { code?: string; error?: string }) => void;
      }): { requestCode(): void };
    };
  };
} | undefined;
import type { AppDispatch, RootState } from '../store';
import {
  setMusicProvider,
  setBiometricProvider,
  setMoodOnly,
  selectIsIntegrationsComplete,
  selectIntegrationsSettled,
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
import WatchTokenCard from '@/components/WatchTokenCard';
import DisconnectButton from '@/components/DisconnectButton';
import type { DisconnectKind } from '@/hooks/useConnections';

// Use the YouTube-specific client ID for the GIS popup if set; fall back to the
// general Google client. The YouTube client ID in Vercel must match YOUTUBE_CLIENT_ID
// in Railway — they must be the same OAuth client for the code exchange to succeed.
const GOOGLE_CLIENT_ID = (import.meta.env.VITE_YOUTUBE_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID) as string | undefined;

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
  /** When set, a connected row shows a Disconnect action for this provider. */
  disconnectKind?: DisconnectKind;
  /** Connected but the stored token is missing a required scope — offer a one-click
   *  re-auth instead of only "Connected" (otherwise the user is stuck: Like 403s
   *  forever and the only action is Disconnect). */
  needsReconnect?: boolean;
}

function ServiceRow({ name, hint, connected, disabled, onConnect, disconnectKind, needsReconnect }: RowProps) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{name}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {connected ? (
        <div className="flex items-center gap-3">
          {needsReconnect ? (
            // show_dialog=true on /spotify/connect re-prompts consent and overwrites
            // the stored token with the full current scope set — no manual disconnect
            // needed. This is what actually fixes a token minted before a scope was added.
            <Button size="sm" variant="outline" className="h-8" onClick={onConnect}>
              Reconnect
            </Button>
          ) : (
            <Badge className="gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Check className="size-3" /> Connected
            </Badge>
          )}
          {disconnectKind && <DisconnectButton kind={disconnectKind} />}
        </div>
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
  const spotifyCanSave = useSelector((s: RootState) => s.integrations.spotifyCanSave);
  const integrationsSettled = useSelector(selectIntegrationsSettled);
  const biometric = useSelector((s: RootState) => s.integrations.biometricProvider);
  const moodOnly = useSelector((s: RootState) => s.integrations.moodOnly);
  const complete = useSelector(selectIsIntegrationsComplete);
  // Connected to Spotify but the token lacks user-library-modify (e.g. it predates
  // the scope) → Like/save 403s. Gate on `settled` so good tokens don't flash a
  // Reconnect prompt while status is still loading.
  const spotifyNeedsReconnect = music === 'spotify' && integrationsSettled && !spotifyCanSave;
  const gsiRef = useRef<HTMLScriptElement | null>(null);

  // Ensure the GIS library is loaded so google.accounts.oauth2 is available.
  useEffect(() => {
    if (document.getElementById('gsi-script')) return;
    const s = document.createElement('script');
    s.id = 'gsi-script';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    document.body.appendChild(s);
    gsiRef.current = s;
    return () => { if (gsiRef.current?.parentNode) gsiRef.current.parentNode.removeChild(gsiRef.current); };
  }, []);

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
    const biometricParam = params.get('biometric') as 'garmin' | 'applehealth' | 'health_connect' | null;
    const errorParam = params.get('error');
    const detailParam = params.get('detail');
    if (musicParam === 'spotify' || musicParam === 'youtube') dispatch(setMusicProvider(musicParam));
    if (biometricParam === 'garmin' || biometricParam === 'applehealth' || biometricParam === 'health_connect')
      dispatch(setBiometricProvider(biometricParam));
    if (errorParam) {
      toast.error(friendlyConnectError(errorParam), {
        description: detailParam ? `Reason: ${detailParam}` : undefined,
        duration: 12000,
      });
    }
    if (musicParam || biometricParam || errorParam) window.history.replaceState({}, '', '/integrations');
  }, [dispatch]);

  // A short-lived single-use connect token authenticates the top-level navigation
  // (no headers possible). See buildConnectUrl — the session JWT never enters the URL.
  const connectSpotify = async () => { window.location.href = await buildConnectUrl(BACKEND_URL, '/api/integrations/spotify/connect'); };

  // YouTube uses GIS popup mode — no redirect URI, so Google's shared-domain
  // restriction never applies. The authorization code is returned to a JS callback
  // and exchanged server-side using redirect_uri='postmessage'.
  const connectYouTube = () => {
    if (!GOOGLE_CLIENT_ID || typeof google === 'undefined' || !google?.accounts?.oauth2) {
      toast.error("YouTube Music isn't available — reload the page and try again.");
      return;
    }
    const client = google.accounts.oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      ux_mode: 'popup',
      callback: async (response) => {
        if (!response.code) {
          if (response.error && response.error !== 'popup_closed_by_user') {
            toast.error("Couldn't connect YouTube Music — please try again.");
          }
          return;
        }
        try {
          const res = await fetch(`${BACKEND_URL}/api/integrations/youtube/connect-gis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ code: response.code }),
          });
          let data: Record<string, unknown> = {};
          try { data = await res.json(); } catch { /* non-JSON body (e.g. 404 HTML) */ }
          if (data.success) {
            dispatch(setMusicProvider('youtube'));
          } else {
            const detail = data.error ? ` (${data.error})` : res.ok ? '' : ` (${res.status})`;
            console.error('[youtube/connect-gis] failed', res.status, data);
            toast.error(`Couldn't connect YouTube Music — please try again.${detail}`);
          }
        } catch (e) {
          console.error('[youtube/connect-gis] fetch error', e);
          toast.error("Couldn't connect YouTube Music — please try again.");
        }
      },
    });
    client.requestCode();
  };

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
              <ServiceRow
                name="Spotify"
                connected={music === 'spotify'}
                onConnect={connectSpotify}
                disconnectKind="spotify"
                needsReconnect={spotifyNeedsReconnect}
                hint={spotifyNeedsReconnect ? 'Reconnect to allow saving songs to your library' : undefined}
              />
              <ServiceRow name="YouTube Music" connected={music === 'youtube'} onConnect={connectYouTube} disconnectKind="youtube" />
            </CardContent>
            {/* Data-handling transparency / connect-time consent. */}
            <p className="px-4 pb-3 text-xs text-muted-foreground">
              By connecting, your listening taste is analysed by AI to generate playlists. Your data is never sold,
              and disconnecting deletes the taste profile we cached.
            </p>
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
              <WatchTokenCard />
              {biometric === 'garmin' && (
                <ServiceRow name="Garmin" hint="Connected via Garmin Connect" connected disconnectKind="garmin" />
              )}
              <ServiceRow name="Apple Health" hint="Available in the iOS app" connected={biometric === 'applehealth'} disabled />
              <ServiceRow
                name="Health Connect"
                hint={
                  biometric === 'health_connect'
                    ? 'Synced via the Kokonada Health companion app'
                    : 'Android only — install the Kokonada Health companion app, enable Garmin Connect → Health Connect sharing, then sync from there'
                }
                connected={biometric === 'health_connect'}
                disabled
              />
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
