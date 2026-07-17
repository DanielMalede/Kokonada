import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Copy, HeartPulse, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { AppDispatch, RootState } from '../../store';
import {
  setWatchConnection, setWatchStatus, selectWatchLiveness,
} from '../../store/slices/integrationsSlice';
import { requestWatchPairingCode, revokeWatchToken, fetchWatchStatus } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

// While a pairing code is on screen, poll for the watch having exchanged it —
// this is the only way the browser learns the watch actually paired, since the
// exchange itself is a direct browser<->watch-app round trip the web client
// never sees.
const PAIRING_POLL_MS = 4_000;

function relativeLastSeen(iso: string | null): string {
  if (!iso) return 'Never seen';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return mins < 1 ? 'Last seen just now' : `Last seen ${mins}m ago`;
}

function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export default function WatchTokenCard() {
  const dispatch = useDispatch<AppDispatch>();
  const connected = useSelector((s: RootState) => s.integrations.watchConnected);
  const lastSeenAt = useSelector((s: RootState) => s.integrations.watchLastSeenAt);
  const status = useSelector((s: RootState) => s.integrations.watchStatus);
  // Re-render every 30s so the relative time + liveness age correctly.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const liveness = useSelector((s: RootState) => selectWatchLiveness(s, now));

  // Short-lived, single-use pairing code (audit L-15) — this is the ONLY watch
  // credential ever held client-side. The real long-lived device token is minted
  // server-side and handed directly to the watch app via the exchange endpoint;
  // it is never fetched, stored, or rendered here.
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  // Hydrate connection status on mount (handles hard refresh).
  useEffect(() => {
    fetchWatchStatus(BACKEND_URL)
      .then((st) => dispatch(setWatchConnection(st)))
      .catch(() => {});
    return () => stopPolling();
  }, [dispatch]);

  // Auto-expire the displayed code, and poll for the watch completing the
  // exchange so the UI flips to "Connected" without the user refreshing.
  useEffect(() => {
    if (!pairing) return;
    const expireTimer = setInterval(() => {
      if (Date.now() >= pairing.expiresAt) {
        setPairing(null);
        stopPolling();
      }
    }, 1_000);
    pollRef.current = setInterval(() => {
      fetchWatchStatus(BACKEND_URL)
        .then((st) => {
          if (st.connected) {
            dispatch(setWatchConnection(st));
            setPairing(null);
            stopPolling();
          }
        })
        .catch(() => {});
    }, PAIRING_POLL_MS);
    return () => { clearInterval(expireTimer); stopPolling(); };
  }, [pairing, dispatch]);

  const generate = async () => {
    dispatch(setWatchStatus('loading'));
    try {
      const { code, expiresAt } = await requestWatchPairingCode(BACKEND_URL);
      setPairing({ code, expiresAt: Date.parse(expiresAt) });
      dispatch(setWatchStatus('idle'));
    } catch {
      dispatch(setWatchStatus('error'));
      toast.error("Couldn't set up the watch — please try again.");
    }
  };

  const copy = async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.code);
      toast.success('Code copied. Enter it in the watch app now.');
    } catch {
      toast.error('Copy failed — enter the code manually.');
    }
  };

  const disconnect = async () => {
    try {
      await revokeWatchToken(BACKEND_URL);
      setPairing(null);
      dispatch(setWatchConnection({ connected: false, lastSeenAt: null }));
      toast.success('Watch disconnected.');
    } catch {
      toast.error("Couldn't disconnect — please try again.");
    }
  };

  const secondsLeft = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <HeartPulse className="size-4 text-coral" /> Watch heart rate
          <span className="ml-auto">
            {connected ? (
              <Badge className={liveness === 'connected'
                ? 'gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'gap-1 bg-muted text-muted-foreground'}>
                {liveness === 'connected' ? <><Check className="size-3" /> Connected</> : 'Offline'}
              </Badge>
            ) : (
              <span className="text-xs font-normal text-muted-foreground">Not set up</span>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!connected && !pairing && (
          <Button onClick={generate} disabled={status === 'loading'} className="h-10 rounded-full">
            {status === 'loading' ? 'Setting up…' : 'Set up watch'}
          </Button>
        )}

        {pairing && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Enter this code in the Kokonada Health watch app. It expires in {secondsLeft}s and can only be used once.
            </p>
            <div className="flex items-center gap-2">
              <code
                className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-center font-mono text-lg tracking-widest"
                aria-label="Pairing code"
              >
                {formatCode(pairing.code)}
              </code>
              <Button onClick={copy} variant="outline" size="sm" className="gap-1 shrink-0" aria-label="Copy code">
                <Copy className="size-3" /> Copy
              </Button>
              <Button onClick={() => setPairing(null)} variant="outline" size="sm" className="shrink-0">
                Cancel
              </Button>
            </div>
          </div>
        )}

        {connected && !pairing && (
          <>
            <p className="text-xs text-muted-foreground">{relativeLastSeen(lastSeenAt)}</p>
            <div className="flex gap-2">
              <Button onClick={generate} variant="outline" size="sm" disabled={status === 'loading'}>
                Re-pair
              </Button>
              <Button onClick={disconnect} variant="outline" size="sm" className="text-destructive">
                Disconnect
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
