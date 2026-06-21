import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch } from '../store';
import { setUser, setAuthStatus } from '../store/slices/authSlice';

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
            navigate('/integrations');
          } catch {
            setError('Google login failed — please try again.');
          }
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
      navigate('/integrations');
    } catch {
      setError('Apple login failed — please try again.');
    }
  };

  const handleFacebookClick = () => {
    setError(null);
    FB.login(async (response) => {
      if (!response.authResponse) {
        setError('Facebook login cancelled.');
        return;
      }
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/facebook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ accessToken: response.authResponse.accessToken }),
        });
        if (!res.ok) throw new Error('auth failed');
        const data = await res.json();
        dispatch(setUser(data));
        dispatch(setAuthStatus('authenticated'));
        navigate('/integrations');
      } catch {
        setError('Facebook login failed — please try again.');
      }
    }, { scope: 'public_profile,email' });
  };

  const btnBase = 'w-full py-2.5 rounded-lg font-semibold transition-opacity flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex flex-col items-center justify-center px-4">
      <div className="bg-[#16213e] rounded-2xl p-8 w-full max-w-sm shadow-2xl flex flex-col items-center">
        <h1 className="text-2xl font-bold text-[#e9c46a] text-center mb-2">Kokonada</h1>
        <p className="text-white/55 text-center mb-8">Your music, tuned to your body.</p>
        <div className="flex flex-col gap-3 w-full">
          <button
            className={`${btnBase} bg-white text-gray-900 hover:bg-gray-100`}
            onClick={handleGoogleClick}
            disabled={!isGsiReady}
            title={!isGsiReady ? 'Loading Google Sign-In…' : undefined}
          >
            Continue with Google
          </button>
          <button
            className={`${btnBase} bg-black text-white hover:bg-gray-900 border border-white/20`}
            onClick={handleAppleClick}
            disabled={!isAppleReady}
            title={!isAppleReady ? 'Loading Apple Sign-In…' : undefined}
          >
            Continue with Apple
          </button>
          <button
            className={`${btnBase} bg-[#1877F2] text-white hover:opacity-90`}
            onClick={handleFacebookClick}
            disabled={!isFbReady}
            title={!isFbReady ? 'Loading Facebook Sign-In…' : undefined}
          >
            Continue with Facebook
          </button>
        </div>
        {error && <p className="text-red-400 text-sm text-center mt-4">{error}</p>}
      </div>
    </div>
  );
}
