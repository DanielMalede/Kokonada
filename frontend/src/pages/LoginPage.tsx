import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../store';
import { setUser, setAuthStatus } from '../store/slices/authSlice';
import './LoginPage.css';

declare const google: {
  accounts: { id: { initialize(cfg: object): void; prompt(): void } };
};

declare const AppleID: {
  auth: {
    init(cfg: object): void;
    signIn(): Promise<{ authorization: { id_token: string } }>;
  };
};

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

export default function LoginPage() {
  const dispatch = useDispatch<AppDispatch>();
  const [error, setError] = useState<string | null>(null);
  const [isGsiReady, setIsGsiReady] = useState(false);
  const [isAppleReady, setIsAppleReady] = useState(false);

  useEffect(() => {
    // Google GSI
    const gScript = document.createElement('script');
    gScript.src = 'https://accounts.google.com/gsi/client';
    gScript.async = true;
    gScript.onload = () => {
      google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: async ({ credential }: { credential: string }) => {
          try {
            const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ idToken: credential }),
            });
            if (!res.ok) throw new Error('auth failed');
            const data = await res.json();
            dispatch(setUser(data));
            dispatch(setAuthStatus('authenticated'));
          } catch {
            setError('Google login failed — please try again.');
          }
        },
      });
      setIsGsiReady(true);
    };
    document.body.appendChild(gScript);

    // Apple Sign In SDK
    const aScript = document.createElement('script');
    aScript.src = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';
    aScript.async = true;
    aScript.onload = () => {
      AppleID.auth.init({
        clientId: import.meta.env.VITE_APPLE_CLIENT_ID,
        scope: 'name email',
        redirectURI: import.meta.env.VITE_APPLE_REDIRECT_URI,
        usePopup: true,
      });
      setIsAppleReady(true);
    };
    document.body.appendChild(aScript);

    return () => {
      document.body.removeChild(gScript);
      document.body.removeChild(aScript);
    };
  }, [dispatch]);

  const handleGoogleClick = () => {
    setError(null);
    google.accounts.id.prompt();
  };

  const handleAppleClick = async () => {
    setError(null);
    try {
      const data = await AppleID.auth.signIn();
      const res = await fetch(`${BACKEND_URL}/api/auth/apple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identityToken: data.authorization.id_token }),
      });
      if (!res.ok) throw new Error('auth failed');
      const user = await res.json();
      dispatch(setUser(user));
      dispatch(setAuthStatus('authenticated'));
    } catch {
      setError('Apple login failed — please try again.');
    }
  };

  return (
    <div className="login-root">
      <div className="login-card">
        <h1 className="login-title">Kokonada</h1>
        <p className="login-tagline">Your music, tuned to your body.</p>
        <div className="sso-buttons">
          <button
            className="sso-btn sso-btn--google"
            onClick={handleGoogleClick}
            disabled={!isGsiReady}
            title={!isGsiReady ? 'Loading Google Sign-In…' : undefined}
          >
            Continue with Google
          </button>
          <button
            className="sso-btn sso-btn--apple"
            onClick={handleAppleClick}
            disabled={!isAppleReady}
            title={!isAppleReady ? 'Loading Apple Sign-In…' : undefined}
          >
            Continue with Apple
          </button>
          <button className="sso-btn" disabled title="Coming soon">
            Continue with Facebook
          </button>
        </div>
        {error && <p className="login-error">{error}</p>}
      </div>
    </div>
  );
}
