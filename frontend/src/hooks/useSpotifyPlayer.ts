import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../store';
import { setSdkState } from '../store/slices/playerSlice';
import { toast } from 'sonner';
import { spotifyPlayerService } from '../services/spotifyPlayer';
import { authHeaders } from '@/lib/api';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

async function fetchSpotifyToken(): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/api/integrations/spotify/token`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) {
    // 401 reconnect_required = the stored refresh token was revoked/expired.
    // Prompt a reconnect instead of silently failing the SDK forever.
    if (res.status === 401) {
      const data = await res.json().catch(() => ({}));
      if (data.code === 'reconnect_required') {
        toast.error('Reconnect Spotify to keep playing', {
          action: { label: 'Reconnect', onClick: () => { window.location.href = '/integrations'; } },
        });
      }
    }
    throw new Error(`Spotify token fetch failed: ${res.status}`);
  }
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

function loadSpotifyScript(): Promise<void> {
  return new Promise((resolve) => {
    if (window.Spotify) { resolve(); return; }
    window.onSpotifyWebPlaybackSDKReady = resolve;
    if (!document.querySelector('script[src*="spotify-player"]')) {
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

export function useSpotifyPlayer(musicProvider: string | null): void {
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    // Destroy and bail out when provider is no longer Spotify
    if (musicProvider !== 'spotify') {
      spotifyPlayerService.destroy();
      return;
    }

    let cancelled = false;

    spotifyPlayerService.onStateChange((state) => {
      if (!cancelled) dispatch(setSdkState(state));
    });

    loadSpotifyScript()
      .then(() => {
        if (!cancelled) return spotifyPlayerService.init(fetchSpotifyToken);
      })
      .catch((err) => console.error('[SpotifySDK] init failed:', err));

    return () => {
      cancelled = true;
      // Do not destroy here — the singleton lives as long as musicProvider === 'spotify'.
      // Destruction is triggered by the next effect run when musicProvider changes away.
    };
  }, [musicProvider, dispatch]);
}
