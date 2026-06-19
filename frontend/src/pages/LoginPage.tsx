declare const google: {
  accounts: { id: { initialize(cfg: object): void; prompt(): void } };
};

import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../store';
import { setUser, setAuthStatus } from '../store/slices/authSlice';
import './LoginPage.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

export default function LoginPage() {
  const dispatch = useDispatch<AppDispatch>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
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
            setError('Login failed — please try again.');
          }
        },
      });
    };
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, [dispatch]);

  const handleGoogleClick = () => {
    setError(null);
    google.accounts.id.prompt();
  };

  return (
    <div className="login-root">
      <div className="login-card">
        <h1 className="login-title">Kokonada</h1>
        <p className="login-tagline">Your music, tuned to your body.</p>
        <div className="sso-buttons">
          <button className="sso-btn sso-btn--google" onClick={handleGoogleClick}>
            Continue with Google
          </button>
          <button className="sso-btn" disabled title="Coming soon">
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
