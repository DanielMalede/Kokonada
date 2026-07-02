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
import { setMusicProvider, setBiometricProvider, setConnections, setSpotifyCanSave } from '@/store/slices/integrationsSlice';
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
  // Playback always runs on Spotify (the playback engine) when connected — independent of
  // which provider built the taste profile. Gate the SDK + play calls on this, not musicProvider.
  const playbackProvider = useSelector((s: RootState) => s.integrations.playbackProvider);
  const { playlist, playbackMode, deviceId } = useSelector((s: RootState) => s.player);
  const isOnline = useSelector((s: RootState) => s.player.isOnline);
  const handledPlaylistRef = useRef<string | null>(null);

  // On the very first render, a playlist already sitting in the store was restored
  // from localStorage on refresh (the socket hasn't delivered one yet). Pre-mark it
  // as handled so the play effect below does NOT auto-restart it from track 1 — the
  // user resumes at the saved track via the play button. Freshly generated playlists
  // (delivered after mount) still auto-play as before.
  const didSeedRestoreRef = useRef(false);
  if (!didSeedRestoreRef.current) {
    didSeedRestoreRef.current = true;
    if (playlist.length > 0) {
      handledPlaylistRef.current = `live:${playlist.map((t) => t.uri).join(',')}`;
    }
  }

  // The INITIAL integration hydration runs in AppBootstrap (above the guards). Here
  // we only RESYNC providers after a network drop (isOnline false→true). This path
  // deliberately does NOT touch integrations.status, so a reconnect never flips the
  // guard back to its "loading" splash over an already-rendered app.
  const resyncIntegrations = useCallback(() => {
    fetch(`${BACKEND_URL}/api/integrations/status`, {
      credentials: 'include',
      headers: authHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        dispatch(setMusicProvider(data.musicProvider));
        dispatch(setConnections({
          spotifyConnected: Boolean(data.spotifyConnected),
          youtubeConnected: Boolean(data.youtubeConnected),
          playbackProvider: data.playbackProvider === 'spotify' ? 'spotify' : null,
        }));
        dispatch(setBiometricProvider(data.biometricProvider));
        dispatch(setSpotifyCanSave(Boolean(data.spotifyCanSave)));
      })
      .catch(() => {});
  }, [dispatch]);

  const wasOnlineRef = useRef(isOnline);
  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) resyncIntegrations();
    wasOnlineRef.current = isOnline;
  }, [isOnline, resyncIntegrations]);

  useSocket();
  useSpotifyPlayer(playbackProvider);
  usePendingPromotion();

  // When a fresh playlist lands, stream it: play on the desktop SDK device, or
  // transfer to the active device on mobile. Deduped by playlist so it fires once.
  // A playlist restored from localStorage on refresh is pre-marked as handled (see
  // the rehydrate effect below) so we DON'T auto-restart it from track 1 — the user
  // resumes it with the play button at the saved track.
  useEffect(() => {
    if (playbackProvider !== 'spotify' || playlist.length === 0) return;
    if (playbackMode !== 'live') return;

    const rawUris = playlist.map((t) => t.uri);
    // Drop malformed/cross-provider URIs before they reach Spotify (one bad URI
    // 400s the whole request). Dedupe the effect on the RAW list so we act — or
    // warn — exactly once per generated playlist.
    const uris = sanitizeTrackUris(rawUris);
    const key = `live:${rawUris.join(',')}`;
    if (handledPlaylistRef.current === key) return;
    handledPlaylistRef.current = key;

    if (uris.length === 0) {
      console.error(`[play] no valid Spotify URIs (of ${rawUris.length}) — skipping`);
      toast.error('These tracks can’t be played on Spotify — try regenerating the playlist.');
      return;
    }

    // Include the SDK deviceId when present (desktop); omit it on mobile so the
    // backend transfers playback to the active device.
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
  }, [playlist, deviceId, playbackProvider, playbackMode]);

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
