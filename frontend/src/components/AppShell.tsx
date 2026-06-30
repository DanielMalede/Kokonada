import { useCallback, useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'sonner';
import type { AppDispatch, RootState } from '@/store';
import { useSocket } from '@/hooks/useSocket';
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer';
import { usePendingPromotion } from '@/hooks/usePendingPromotion';
import { authHeaders } from '@/lib/api';
import { sanitizeTrackUris } from '@/lib/spotifyUri';
import { setMusicProvider, setBiometricProvider, setSpotifyCanSave } from '@/store/slices/integrationsSlice';
import EmotionAura from './EmotionAura';
import BottomNav from './BottomNav';
import DesktopSidebar from './DesktopSidebar';
import ProfileBuildBanner from './ProfileBuildBanner';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

/**
 * Shared layout for every authenticated core page (Dashboard, Now Playing,
 * History, Profile, Settings…). It owns the live connections so they persist
 * across in-app navigation: the Socket.IO link, the Spotify SDK, and the
 * "play this playlist when it arrives" trigger that used to live on AppPage.
 */
export default function AppShell() {
  const dispatch = useDispatch<AppDispatch>();
  const musicProvider = useSelector((s: RootState) => s.integrations.musicProvider);
  const { playlist, playbackMode, deviceId } = useSelector((s: RootState) => s.player);
  const isOnline = useSelector((s: RootState) => s.player.isOnline);
  const handledPlaylistRef = useRef<string | null>(null);

  // Redux resets on every page refresh — rehydrate integration state so the
  // Spotify SDK initializes and the playback effect can fire. Re-run on
  // reconnect (isOnline false→true) so state resyncs after a brief network drop.
  const rehydrateIntegrations = useCallback(() => {
    fetch(`${BACKEND_URL}/api/integrations/status`, {
      credentials: 'include',
      headers: authHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        dispatch(setMusicProvider(data.musicProvider));
        dispatch(setBiometricProvider(data.biometricProvider));
        dispatch(setSpotifyCanSave(Boolean(data.spotifyCanSave)));
      })
      .catch(() => {});
  }, [dispatch]);

  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    rehydrateIntegrations();
  }, [rehydrateIntegrations]);
  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) rehydrateIntegrations();
    wasOnlineRef.current = isOnline;
  }, [isOnline, rehydrateIntegrations]);

  useSocket();
  useSpotifyPlayer(musicProvider);
  usePendingPromotion();

  // When a fresh playlist lands, act on the chosen playback mode: 'live' streams
  // it (desktop SDK device, or transfer to the active device on mobile); 'export'
  // saves it as a new Spotify playlist. Deduped by playlist+mode so it fires once.
  useEffect(() => {
    if (musicProvider !== 'spotify' || playlist.length === 0) return;
    if (playbackMode !== 'live' && playbackMode !== 'export') return;

    const rawUris = playlist.map((t) => t.uri);
    // Drop malformed/cross-provider URIs before they reach Spotify (one bad URI
    // 400s the whole request). Dedupe the effect on the RAW list so we act — or
    // warn — exactly once per generated playlist.
    const uris = sanitizeTrackUris(rawUris);
    const key = `${playbackMode}:${rawUris.join(',')}`;
    if (handledPlaylistRef.current === key) return;
    handledPlaylistRef.current = key;

    if (uris.length === 0) {
      console.error(`[play] no valid Spotify URIs (of ${rawUris.length}) — skipping ${playbackMode}`);
      toast.error('These tracks can’t be played on Spotify — try regenerating the playlist.');
      return;
    }

    if (playbackMode === 'export') {
      const name = `Kokonada — ${new Date().toLocaleDateString()}`;
      console.info(`[export] POST tracks=${uris.length}`);
      fetch(`${BACKEND_URL}/api/integrations/spotify/export`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ uris, name }),
      })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            toast.success('Saved to Spotify ✓', {
              action: data.url
                ? { label: 'Open', onClick: () => window.open(data.url, '_blank') }
                : undefined,
            });
            return;
          }
          if (res.status === 409) {
            const data = await res.json().catch(() => ({}));
            if (data.reason === 'reconnect_required') {
              toast.error('Reconnect Spotify to save playlists', {
                action: { label: 'Reconnect', onClick: () => { window.location.href = '/integrations'; } },
              });
              return;
            }
          }
          console.error(`[export] failed: ${res.status}`);
          toast.error('Could not save to Spotify — please try again.');
        })
        .catch((err) => {
          console.error('[export] failed:', err);
          toast.error('Could not save to Spotify — please try again.');
        });
      return;
    }

    // playbackMode === 'live': include the SDK deviceId when present (desktop);
    // omit it on mobile so the backend transfers playback to the active device.
    console.info(`[play] POST tracks=${uris.length} deviceId=${deviceId ?? 'active'}`);
    fetch(`${BACKEND_URL}/api/integrations/spotify/play`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(deviceId ? { uris, deviceId } : { uris }),
    })
      .then(async (res) => {
        if (res.ok) return;
        if (res.status === 409) {
          const data = await res.json().catch(() => ({}));
          if (data.reason === 'no_active_device') {
            toast.error('Open Spotify and start playback on a device, then try again.', {
              action: { label: 'Open Spotify', onClick: () => window.open('https://open.spotify.com', '_blank') },
            });
            return;
          }
        }
        console.error(`[play] failed: ${res.status}`);
        toast.error('Could not start playback — please try again.');
      })
      .catch((err) => {
        console.error('[play] failed:', err);
        toast.error('Could not start playback — please try again.');
      });
  }, [playlist, deviceId, musicProvider, playbackMode]);

  return (
    <>
      <EmotionAura />
      <div className="relative z-10 flex min-h-dvh">
        <DesktopSidebar />
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-5xl px-4 pb-40 pt-5 md:px-8 md:pb-12 md:pt-8">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav />
      <ProfileBuildBanner />
    </>
  );
}
