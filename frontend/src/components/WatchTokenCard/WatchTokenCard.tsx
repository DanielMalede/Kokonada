import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Copy, HeartPulse, Check } from 'lucide-react';
import { toast } from 'sonner';
import type { AppDispatch, RootState } from '../../store';
import {
  setWatchToken, setWatchConnection, clearWatchToken, setWatchStatus, selectWatchLiveness,
} from '../../store/slices/integrationsSlice';
import { issueWatchToken, revokeWatchToken, fetchWatchStatus } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

function relativeLastSeen(iso: string | null): string {
  if (!iso) return 'Never seen';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return mins < 1 ? 'Last seen just now' : `Last seen ${mins}m ago`;
}

export default function WatchTokenCard() {
  const dispatch = useDispatch<AppDispatch>();
  const token = useSelector((s: RootState) => s.integrations.watchToken);
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

  // Hydrate connection status on mount (handles hard refresh).
  useEffect(() => {
    fetchWatchStatus(BACKEND_URL)
      .then((st) => dispatch(setWatchConnection(st)))
      .catch(() => {});
  }, [dispatch]);

  const generate = async () => {
    dispatch(setWatchStatus('loading'));
    try {
      const t = await issueWatchToken(BACKEND_URL);
      dispatch(setWatchToken(t));
      dispatch(setWatchConnection({ connected: true, lastSeenAt: null }));
      dispatch(setWatchStatus('idle'));
    } catch {
      dispatch(setWatchStatus('error'));
      toast.error("Couldn't set up the watch — please try again.");
    }
  };

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.success('Token copied. Paste it into the watch app now.');
    } catch {
      toast.error('Copy failed — select and copy the token manually.');
    }
  };

  const disconnect = async () => {
    try {
      await revokeWatchToken(BACKEND_URL);
      dispatch(clearWatchToken());
      toast.success('Watch disconnected.');
    } catch {
      toast.error("Couldn't disconnect — please try again.");
    }
  };

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
        {!connected && !token && (
          <Button onClick={generate} disabled={status === 'loading'} className="h-10 rounded-full">
            {status === 'loading' ? 'Setting up…' : 'Set up watch'}
          </Button>
        )}

        {token && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Copy this token now — it won't be shown again. Paste it into the watch app.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{token}</code>
              <Button onClick={copy} variant="outline" size="sm" className="gap-1 shrink-0" aria-label="Copy token">
                <Copy className="size-3" /> Copy
              </Button>
            </div>
          </div>
        )}

        {connected && (
          <>
            <p className="text-xs text-muted-foreground">{relativeLastSeen(lastSeenAt)}</p>
            <div className="flex gap-2">
              <Button onClick={generate} variant="outline" size="sm" disabled={status === 'loading'}>
                Regenerate
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
