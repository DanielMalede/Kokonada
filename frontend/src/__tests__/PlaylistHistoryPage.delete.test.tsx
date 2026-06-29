import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import PlaylistHistoryPage from '../pages/PlaylistHistoryPage';
import playerReducer from '../store/slices/playerSlice';
import { saveSession, getSessions, type Session } from '../lib/history';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

const buildStore = () => configureStore({ reducer: { player: playerReducer } });

function seed(id: string, moodLabel: string, createdAt: number) {
  const s: Session = {
    id, moodKey: 'focus', moodLabel, textPrompt: '', mode: 'live',
    heartRate: null, activity: null, createdAt,
    tracks: [{ id: `tr-${id}`, title: 't', artist: 'a', uri: `spotify:track:${id}` }],
  };
  saveSession(s);
}

const renderPage = () =>
  render(
    <Provider store={buildStore()}>
      <MemoryRouter><PlaylistHistoryPage /></MemoryRouter>
    </Provider>,
  );

describe('PlaylistHistoryPage — delete', () => {
  beforeEach(() => localStorage.clear());

  it('deletes a single session via its delete button', () => {
    seed('a', 'Focus', 2);
    seed('b', 'Calm', 1);
    renderPage();

    expect(screen.getByText('Calm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete calm session/i }));

    expect(getSessions().map((s) => s.id)).toEqual(['a']);
    expect(screen.queryByText('Calm')).not.toBeInTheDocument();
  });

  it('bulk-deletes selected sessions in multi-select mode', () => {
    seed('a', 'Focus', 3);
    seed('b', 'Calm', 2);
    seed('c', 'Energize', 1);
    renderPage();

    // Enter select mode, then pick two sessions.
    fireEvent.click(screen.getByRole('button', { name: /^select$/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select focus session/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /select energize session/i }));

    // The bulk action reflects the count and removes both.
    fireEvent.click(screen.getByRole('button', { name: /delete selected \(2\)/i }));

    expect(getSessions().map((s) => s.id)).toEqual(['b']);
    expect(screen.queryByText('Focus')).not.toBeInTheDocument();
    expect(screen.queryByText('Energize')).not.toBeInTheDocument();
    expect(screen.getByText('Calm')).toBeInTheDocument();
  });
});
