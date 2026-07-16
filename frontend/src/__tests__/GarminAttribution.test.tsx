import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import integrationsReducer from '../store/slices/integrationsSlice';
import GarminAttribution from '../components/GarminAttribution';

function buildStore(biometricProvider: 'garmin' | 'applehealth' | 'health_connect' | null) {
  return configureStore({
    reducer: { integrations: integrationsReducer },
    preloadedState: {
      integrations: {
        musicProvider: null, spotifyConnected: false, youtubeConnected: false, playbackProvider: null,
        biometricProvider, spotifyCanSave: false, profileProgress: null, moodOnly: false, status: 'idle',
        watchToken: null, watchConnected: false, watchLastSeenAt: null, watchStatus: 'idle',
      },
    } as never,
  });
}

describe('GarminAttribution', () => {
  it('renders "Powered by Garmin" when biometricProvider is garmin', () => {
    render(<Provider store={buildStore('garmin')}><GarminAttribution /></Provider>);
    expect(screen.getByText(/powered by garmin/i)).toBeInTheDocument();
  });

  it('renders nothing when the biometric source is Apple Health', () => {
    const { container } = render(<Provider store={buildStore('applehealth')}><GarminAttribution /></Provider>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the biometric source is Health Connect', () => {
    const { container } = render(<Provider store={buildStore('health_connect')}><GarminAttribution /></Provider>);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no biometric source is connected', () => {
    const { container } = render(<Provider store={buildStore(null)}><GarminAttribution /></Provider>);
    expect(container).toBeEmptyDOMElement();
  });
});
