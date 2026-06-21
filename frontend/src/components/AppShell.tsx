import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { useSocket } from '@/hooks/useSocket';
import { useSpotifyPlayer } from '@/hooks/useSpotifyPlayer';
import { authHeaders } from '@/lib/api';
import EmotionAura from './EmotionAura';
import BottomNav from './BottomNav';
import DesktopSidebar from './DesktopSidebar';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

/**
 * Shared layout for every authenticated core page (Dashboard, Now Playing,
 * History, Profile, Settings…). It owns the live connections so they persist
 * across in-app navigation: the Socket.IO link, the Spotify SDK, and the
 * "play this playlist when it arrives" trigger that used to live on AppPage.
 */
export default function AppShell() {
  const musicProvider = useSelector((s: RootState) => s.integrations.musicProvider);
  const { playlist, playbackMode, deviceId } = useSelector((s: RootState) => s.player);
  const playedPlaylistRef = useRef<string | null>(null);

  useSocket();
  useSpotifyPlayer(musicProvider);

  useEffect(() => {
    if (playbackMode !== 'live' || musicProvider !== 'spotify' || !deviceId || playlist.length === 0)
      return;

    const playlistKey = playlist.map((t) => t.uri).join(',');
    if (playedPlaylistRef.current === playlistKey) return;
    playedPlaylistRef.current = playlistKey;

    fetch(`${BACKEND_URL}/api/integrations/spotify/play`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ uris: playlist.map((t) => t.uri), deviceId }),
    })
      .then((res) => {
        if (!res.ok) console.error(`[Spotify] play failed: ${res.status}`);
      })
      .catch((err) => console.error('[Spotify] play failed:', err));
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
    </>
  );
}
