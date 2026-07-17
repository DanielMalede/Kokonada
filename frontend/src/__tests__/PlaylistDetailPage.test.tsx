import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import PlaylistDetailPage from '../pages/PlaylistDetailPage';
import playerReducer from '../store/slices/playerSlice';
import integrationsReducer from '../store/slices/integrationsSlice';
import { saveSession, type Session } from '../lib/history';

// Compliance (Wave 5 NEEDS CHANGE): this saved-session tracklist showed Spotify
// title/artist metadata and a Garmin-sourced HR badge with NO attribution on either.

function buildStore(biometricProvider: 'garmin' | 'applehealth' | null = null) {
  return configureStore({
    reducer: { player: playerReducer, integrations: integrationsReducer },
    preloadedState: {
      integrations: {
        musicProvider: null, spotifyConnected: false, youtubeConnected: false, playbackProvider: null,
        biometricProvider, spotifyCanSave: false, profileProgress: null, moodOnly: false, status: 'idle',
        watchToken: null, watchConnected: false, watchLastSeenAt: null, watchStatus: 'idle',
      },
    } as never,
  });
}

function seed(session: Session) {
  saveSession(session);
}

const renderPage = (id: string, biometricProvider: 'garmin' | 'applehealth' | null = null) =>
  render(
    <Provider store={buildStore(biometricProvider)}>
      <MemoryRouter initialEntries={[`/history/${id}`]}>
        <Routes>
          <Route path="/history/:id" element={<PlaylistDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

describe('PlaylistDetailPage — attribution', () => {
  beforeEach(() => localStorage.clear());

  it('links every Spotify track row back to open.spotify.com', () => {
    seed({
      id: 'sess-1', moodKey: 'focus', moodLabel: 'Focus', textPrompt: '', mode: 'live',
      heartRate: null, activity: null, createdAt: Date.now(),
      tracks: [
        { id: 't1', title: 'Song One', artist: 'Artist A', uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' },
        { id: 't2', title: 'Song Two', artist: 'Artist B', uri: 'spotify:track:1a2b3c4d5e6f7g8h9i0j1k' },
      ],
    });
    renderPage('sess-1');

    const links = screen.getAllByRole('link', { name: /listen on spotify/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
    expect(links[1]).toHaveAttribute('href', 'https://open.spotify.com/track/1a2b3c4d5e6f7g8h9i0j1k');
  });

  it('does not attribute a non-Spotify (YouTube Music) track row', () => {
    seed({
      id: 'sess-2', moodKey: 'focus', moodLabel: 'Focus', textPrompt: '', mode: 'live',
      heartRate: null, activity: null, createdAt: Date.now(),
      tracks: [{ id: 't1', title: 'YT Song', artist: 'Artist C', uri: 'youtube_music:track:abc123' }],
    });
    renderPage('sess-2');

    expect(screen.queryByRole('link', { name: /listen on spotify/i })).not.toBeInTheDocument();
  });

  it('shows Garmin attribution when the HR badge is present and the source is garmin', () => {
    seed({
      id: 'sess-3', moodKey: 'focus', moodLabel: 'Focus', textPrompt: '', mode: 'live',
      heartRate: 112, activity: null, createdAt: Date.now(),
      tracks: [{ id: 't1', title: 'Song', artist: 'Artist', uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' }],
    });
    renderPage('sess-3', 'garmin');

    expect(screen.getByText(/powered by garmin/i)).toBeInTheDocument();
  });

  it('does not show Garmin attribution when the connected source is not Garmin', () => {
    seed({
      id: 'sess-4', moodKey: 'focus', moodLabel: 'Focus', textPrompt: '', mode: 'live',
      heartRate: 112, activity: null, createdAt: Date.now(),
      tracks: [{ id: 't1', title: 'Song', artist: 'Artist', uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' }],
    });
    renderPage('sess-4', 'applehealth');

    expect(screen.queryByText(/powered by garmin/i)).not.toBeInTheDocument();
  });

  it('does not show Garmin attribution when the session has no heart rate', () => {
    seed({
      id: 'sess-5', moodKey: 'focus', moodLabel: 'Focus', textPrompt: '', mode: 'live',
      heartRate: null, activity: null, createdAt: Date.now(),
      tracks: [{ id: 't1', title: 'Song', artist: 'Artist', uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' }],
    });
    renderPage('sess-5', 'garmin');

    expect(screen.queryByText(/powered by garmin/i)).not.toBeInTheDocument();
  });
});
