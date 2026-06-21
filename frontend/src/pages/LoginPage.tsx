import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Disc3, Loader2 } from 'lucide-react';
import type { AppDispatch } from '../store';
import { setUser, setAuthStatus } from '../store/slices/authSlice';
import { setToken } from '@/lib/api';

declare const google: {
  accounts: { id: { initialize(cfg: object): void; prompt(): void } };
};

declare const AppleID: {
  auth: {
    init(cfg: object): void;
    signIn(): Promise<{ authorization: { id_token: string } }>;
  };
};

declare const FB: {
  init(cfg: object): void;
  login(
    callback: (response: { authResponse?: { accessToken: string } }) => void,
    opts: { scope: string }
  ): void;
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

export default function LoginPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [isGsiReady, setIsGsiReady] = useState(false);
  const [isAppleReady, setIsAppleReady] = useState(false);
  const [isFbReady, setIsFbReady] = useState(false);
  const [loading, setLoading] = useState<'google' | 'apple' | 'facebook' | null>(null);

  useEffect(() => {
    // Google GSI
    const gScript = document.createElement('script');
    gScript.src = 'https://accounts.google.com/gsi/client';
    gScript.async = true;
    gScript.onload = () => {
      google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        // Must be a plain (non-async) function — the GSI SDK rejects async
        // callbacks with "Expression is of type asyncfunction, not function".
        callback: ({ credential }: { credential: string }) => {
          setLoading('google');
          void (async () => {
            try {
              const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ idToken: credential }),
              });
              if (!res.ok) throw new Error('auth failed');
              const data = await res.json();
              if (data.token) setToken(data.token);
              dispatch(setUser(data.user ?? data));
              dispatch(setAuthStatus('authenticated'));
              navigate('/integrations');
            } catch {
              setError('Google login failed — please try again.');
            } finally {
              setLoading(null);
            }
          })();
        },
      });
      setIsGsiReady(true);
    };
    document.body.appendChild(gScript);

    // Apple Sign In SDK — only load if clientId is configured
    const appleClientId = import.meta.env.VITE_APPLE_CLIENT_ID;
    const aScript = document.createElement('script');
    if (appleClientId) {
      aScript.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
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
      document.body.appendChild(aScript);
    }

    // Facebook SDK
    const fbScript = document.createElement('script');
    fbScript.src = 'https://connect.facebook.net/en_US/sdk.js';
    fbScript.async = true;
    fbScript.onload = () => {
      FB.init({
        appId: import.meta.env.VITE_FACEBOOK_APP_ID,
        cookie: true,
        xfbml: true,
        version: 'v19.0',
      });
      setIsFbReady(true);
    };
    document.body.appendChild(fbScript);

    return () => {
      document.body.removeChild(gScript);
      if (appleClientId && aScript.parentNode) document.body.removeChild(aScript);
      document.body.removeChild(fbScript);
    };
  }, [dispatch]);

  const handleGoogleClick = () => {
    setError(null);
    google.accounts.id.prompt();
  };

  const handleAppleClick = async () => {
    setError(null);
    setLoading('apple');
    try {
      const data = await AppleID.auth.signIn();
      const res = await fetch(`${BACKEND_URL}/api/auth/apple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identityToken: data.authorization.id_token }),
      });
      if (!res.ok) throw new Error('auth failed');
      const body = await res.json();
      if (body.token) setToken(body.token);
      dispatch(setUser(body.user ?? body));
      dispatch(setAuthStatus('authenticated'));
      navigate('/integrations');
    } catch {
      setError('Apple login failed — please try again.');
    } finally {
      setLoading(null);
    }
  };

  const handleFacebookClick = () => {
    setError(null);
    setLoading('facebook');
    // Must be a plain (non-async) function — the FB SDK rejects async
    // callbacks with "Expression is of type asyncfunction, not function".
    FB.login((response) => {
      if (!response.authResponse) {
        setError('Facebook login cancelled.');
        setLoading(null);
        return;
      }
      void (async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/api/auth/facebook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ accessToken: response.authResponse!.accessToken }),
          });
          if (!res.ok) throw new Error('auth failed');
          const data = await res.json();
          if (data.token) setToken(data.token);
          dispatch(setUser(data.user ?? data));
          dispatch(setAuthStatus('authenticated'));
          navigate('/integrations');
        } catch {
          setError('Facebook login failed — please try again.');
        } finally {
          setLoading(null);
        }
      })();
    }, { scope: 'public_profile,email' });
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

        <div className="flex w-full flex-col gap-3">
          <button
            onClick={handleGoogleClick}
            disabled={!isGsiReady || loading !== null}
            className={provider}
          >
            {loading === 'google' ? <Loader2 className="size-5 animate-spin" /> : 'Continue with Google'}
          </button>
          <button
            onClick={handleAppleClick}
            disabled={!isAppleReady || loading !== null}
            className={provider}
          >
            {loading === 'apple' ? <Loader2 className="size-5 animate-spin" /> : 'Continue with Apple'}
          </button>
          <button
            onClick={handleFacebookClick}
            disabled={!isFbReady || loading !== null}
            className={provider}
          >
            {loading === 'facebook' ? <Loader2 className="size-5 animate-spin" /> : 'Continue with Facebook'}
          </button>
        </div>

        {error && <p className="mt-4 text-center text-sm text-destructive">{error}</p>}

        <p className="mt-8 max-w-xs text-center text-xs text-muted-foreground">
          By continuing you agree to our Terms and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
