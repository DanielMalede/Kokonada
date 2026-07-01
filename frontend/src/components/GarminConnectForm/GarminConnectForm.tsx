import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Watch, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AppDispatch, RootState } from '../../store';
import { setBiometricProvider } from '../../store/slices/integrationsSlice';
import { connectGarminCredentials } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

// EXPERIMENT (backend flag GARMIN_CONNECT_PULL): a self-contained Garmin Connect
// credential form. It is a sibling of WatchTokenCard inside the IntegrationsPage
// biometric card and is intentionally separate from the OAuth-only LoginPage.
// On success the backend pulls a full biometric snapshot and flips the user's
// biometric provider to 'garmin'.
export default function GarminConnectForm() {
  const dispatch = useDispatch<AppDispatch>();
  const biometric = useSelector((s: RootState) => s.integrations.biometricProvider);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already linked — the page's Garmin ServiceRow shows the connected state.
  if (biometric === 'garmin') return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await connectGarminCredentials(BACKEND_URL, email, password);
      dispatch(setBiometricProvider('garmin'));
      setEmail('');
      setPassword('');
      toast.success('Garmin connected — pulled your latest biometrics.');
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message =
        code === 'invalid_credentials' ? 'Incorrect Garmin email or password.'
        : code === 'mfa_unsupported' ? 'Garmin accounts with two-factor auth aren’t supported yet.'
        : code === 'disabled' ? 'Garmin Connect linking is not enabled.'
        : 'Couldn’t connect to Garmin — please try again.';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="py-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Watch className="size-4 text-coral" /> Garmin Connect
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Sign in to pull heart rate, HRV, sleep, body battery &amp; more.
      </p>

      <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="garmin-email">Garmin email</Label>
          <Input
            id="garmin-email"
            type="email"
            autoComplete="username"
            placeholder="you@example.com"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            disabled={loading}
            aria-invalid={!!error}
            required
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="garmin-password">Password</Label>
          <Input
            id="garmin-password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(ev) => setPassword(ev.target.value)}
            disabled={loading}
            aria-invalid={!!error}
            required
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" size="sm" className="h-9 gap-1.5" disabled={loading || !email || !password}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Watch className="size-3.5" />}
          {loading ? 'Connecting…' : 'Connect Garmin'}
        </Button>

        <p className="text-[11px] leading-snug text-muted-foreground">
          Your password is used once to sign in and is never stored. Two-factor (MFA)
          accounts aren’t supported in this test.
        </p>
      </form>
    </div>
  );
}
