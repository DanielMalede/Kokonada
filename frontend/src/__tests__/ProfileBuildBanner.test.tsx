import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import ProfileBuildBanner from '../components/ProfileBuildBanner';
import integrationsReducer from '../store/slices/integrationsSlice';

type Progress = { pct: number; label: string; error?: boolean } | null;
function renderWith(progress: Progress) {
  const store = configureStore({
    reducer: { integrations: integrationsReducer },
    preloadedState: { integrations: { profileProgress: progress } } as never,
  });
  return render(<Provider store={store}><ProfileBuildBanner /></Provider>);
}

describe('ProfileBuildBanner', () => {
  it('renders nothing when there is no build in progress', () => {
    const { container } = renderWith(null);
    expect(container.firstChild).toBeNull();
  });

  it('shows the current step label and percent while analysing', () => {
    renderWith({ pct: 55, label: 'Analysed your Spotify library' });
    expect(screen.getByText('Analysed your Spotify library')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
  });
});
