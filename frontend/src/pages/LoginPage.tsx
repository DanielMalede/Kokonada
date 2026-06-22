import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Disc3, Loader2 } from 'lucide-react';
import type { AppDispatch } from '../store';
import { setUser, setAuthStatus } from '../store/slices/authSlice';
import { setToken } from '@/lib/api';

declare const google: {
  accounts: {
    id: {
      initialize(cfg: object): void;
      renderButton(parent: HTMLElement, options: object): void;
    };
  };
};

declare const AppleID: {
  auth: {
    init(cfg: object): void;
    signIn(): Promise<{ authorization: { id_token: string } }>;
  };
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

// Treat the scaffold placeholder as "unconfigured" so a misconfigured build
// surfaces a clear message instead of a silently dead button. (audit F-G1)
const googleConfigured =
  !!GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID !== 'your_google_client_id_here';

type Provider = 'google' | 'apple';

export default function LoginPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGsiReady, setIsGsiReady] = useState(false);
  const [isAppleReady, setIsAppleReady] = useState(false);
  const [loading, setLoading] = useState<Provider | null>(null);

  // Exchange a provider token for our session JWT, then route in. Surfaces the
  // backend's real error message instead of swallowing it. (audit F-UI2)
  async function completeLogin(path: string, body: object, label: Provider) {
    setError(null);
    setLoading(label);
    try {
      const res = await fetch(`${BACKEND_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Sign-in failed (HTTP ${res.status}).`);
      }
      if (data.token) setToken(data.token);
      dispatch(setUser(data.user ?? data));
      dispatch(setAuthStatus('authenticated'));
      navigate('/integrations');
    } catch (err) {
      console.error(`[auth] ${label} login failed:`, err);
      setError(
        err instanceof Error ? err.message : `${label} login failed — please try again.`
      );
    } finally {
      setLoading(null);
    }
  }

  useEffect(() => {
    // ── Google Identity Services ──────────────────────────────────────────────
    if (!googleConfigured) {
      setError('Google Sign-In is not configured for this build (missing VITE_GOOGLE_CLIENT_ID).');
    }
    const gScript = document.createElement('script');
    gScript.src = 'https://accounts.google.com/gsi/client';
    gScript.async = true;
    gScript.onload = () => {
      if (!googleConfigured) return;
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        // Plain (non-async) callback — the GSI SDK rejects async callbacks with
        // "Expression is of type asyncfunction, not function."
        callback: ({ credential }: { credential: string }) => {
          void completeLogin('/api/auth/google', { idToken: credential }, 'google');
        },
      });
      // Official rendered button instead of One Tap prompt(): it always opens the
      // Google account chooser, so it can't silently no-op the way prompt() does
      // when One Tap is suppressed (FedCM / 3p-cookie blocking / cooldown). (audit F-UI1)
      if (googleBtnRef.current) {
        google.accounts.id.renderButton(googleBtnRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          logo_alignment: 'center',
          width: 320,
        });
      }
      setIsGsiReady(true);
    };
    // Ad-blockers / network failures must not leave a dead button. (audit F-UI3)
    gScript.onerror = () =>
      setError('Couldn’t load Google Sign-In. Disable any ad/tracker blocker and reload.');
    document.body.appendChild(gScript);

    // ── Apple Sign In (only if configured) ────────────────────────────────────
    const appleClientId = import.meta.env.VITE_APPLE_CLIENT_ID;
    const aScript = document.createElement('script');
    if (appleClientId) {
      aScript.src =
        'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
      aScript.async = true;
      aScript.onload = () => {
        AppleID.auth.init({
          clientId: appleClientId,
          scope: 'name email',
          redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI,
          usePopup: true,
        });
        setIsAppleReady(true);
      };
      aScript.onerror = () =>
        setError('Couldn’t load Apple Sign-In. Disable any ad/tracker blocker and reload.');
      document.body.appendChild(aScript);
    }

    return () => {
      if (gScript.parentNode) document.body.removeChild(gScript);
      if (appleClientId && aScript.parentNode) document.body.removeChild(aScript);
    };
  }, [dispatch]);

  const handleAppleClick = async () => {
    setError(null);
    try {
      const data = await AppleID.auth.signIn();
      await completeLogin('/api/auth/apple', { identityToken: data.authorization.id_token }, 'apple');
    } catch (err) {
      // Apple rejects with { error: 'popup_closed_by_user' } on user cancel. (audit Case C)
      const code = (err as { error?: string })?.error;
      if (code === 'popup_closed_by_user' || code === 'user_cancelled_authorize') {
        setError('Apple sign-in cancelled.');
      } else {
        console.error('[auth] apple login failed:', err);
        setError('Apple login failed — please try again.');
      }
    }
  };

  const provider =
    'flex h-[52px] w-full items-center justify-center gap-3 rounded-full border border-border bg-card text-sm font-semibold text-foreground ring-1 ring-foreground/5 transition-all duration-100 hover:bg-muted active:scale-[0.97] active:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100';

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-6">
      <div className="emotion-aura" aria-hidden="true" />
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center">
        <div className="mb-5 grid size-14 place-items-center rounded-2xl bg-linear-to-br from-emotion-focus to-emotion-unwind text-primary-foreground shadow-xl">
          <Disc3 className="size-7" />
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">Kokonada</h1>
        <p className="mb-9 mt-1 text-center text-muted-foreground">Your music, tuned to you.</p>

        <div className="flex w-full flex-col items-center gap-3">
          {/* Google's official rendered button mounts here once the SDK loads. */}
          <div ref={googleBtnRef} className="flex min-h-[40px] w-full justify-center" />
          {googleConfigured && !isGsiReady && (
            <div className={provider} aria-busy="true">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )}

          {isAppleReady && (
            <button onClick={handleAppleClick} disabled={loading !== null} className={provider}>
              {loading === 'apple' ? <Loader2 className="size-5 animate-spin" /> : 'Continue with Apple'}
            </button>
          )}
        </div>

        {loading === 'google' && (
          <p className="mt-4 flex items-center gap-2 text-center text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Signing you in…
          </p>
        )}
        {error && <p className="mt-4 text-center text-sm text-destructive">{error}</p>}

        <p className="mt-8 max-w-xs text-center text-xs text-muted-foreground">
          By continuing you agree to our Terms and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
