import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import AppPage from '../pages/AppPage';
import playerReducer, { setPlaylist } from '../store/slices/playerSlice';
import emotionReducer from '../store/slices/emotionSlice';
import authReducer from '../store/slices/authSlice';
import biometricsReducer from '../store/slices/biometricsSlice';
import integrationsReducer from '../store/slices/integrationsSlice';

vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({ requestPlaylist: vi.fn(), requestHeartPlaylist: vi.fn() }),
}));
vi.mock('@/lib/history', () => ({ saveSession: vi.fn(), makeSessionId: () => 's1' }));

function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      emotion: emotionReducer,
      player: playerReducer,
      biometrics: biometricsReducer,
      integrations: integrationsReducer,
    },
  });
}

// Spotify uris must be exactly 22 base-62 chars (SpotifyAttribution's own gate).
const spotifyTrack = (id: string) => ({
  id, title: `T${id}`, artist: 'A', uri: `spotify:track:${id.padEnd(22, '0')}`,
});
const youtubeTrack = (id: string) => ({ id, title: `T${id}`, artist: 'A', uri: `youtube_music:track:${id}` });

// Compliance (Wave 5 NEEDS CHANGE): the dashboard's "Up next" card showed Spotify
// title/artist metadata with no link-back anywhere.
describe('AppPage — Up next card attribution', () => {
  it('links a Spotify track row back to open.spotify.com', () => {
    const store = makeStore();
    store.dispatch(setPlaylist({
      tracks: [spotifyTrack('a'), spotifyTrack('b'), spotifyTrack('c')],
      trigger: 'emotion',
    }));
    render(<Provider store={store}><MemoryRouter><AppPage /></MemoryRouter></Provider>);

    // Track 'a' is the current track (index 0), so "Up next" shows only 'b' and 'c'.
    const links = screen.getAllByRole('link', { name: /listen on spotify/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('open.spotify.com/track/'));
  });

  it('does not attribute a non-Spotify row', () => {
    const store = makeStore();
    store.dispatch(setPlaylist({
      tracks: [spotifyTrack('cur'), spotifyTrack('b'), youtubeTrack('c')],
      trigger: 'emotion',
    }));
    render(<Provider store={store}><MemoryRouter><AppPage /></MemoryRouter></Provider>);

    // 'cur' is the current track (not in "Up next"); of the two queued rows, only the
    // Spotify one ('b') is attributed — the queued YouTube Music row ('c') carries none.
    expect(screen.getAllByRole('link', { name: /listen on spotify/i })).toHaveLength(1);
  });
});
