import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import biometricsReducer from '../store/slices/biometricsSlice';
import integrationsReducer from '../store/slices/integrationsSlice';
import HRZoneBar from '../components/HRZoneBar';

function buildStore(heartRate: number | null, biometricProvider: 'garmin' | 'applehealth' | 'health_connect' | null) {
  return configureStore({
    reducer: { biometrics: biometricsReducer, integrations: integrationsReducer },
    preloadedState: {
      biometrics: { heartRate, activity: null, calibrationState: 'stable', secondsUntilRecalibration: null, lastAck: null },
      integrations: {
        musicProvider: null, spotifyConnected: false, youtubeConnected: false, playbackProvider: null,
        biometricProvider, spotifyCanSave: false, profileProgress: null, moodOnly: false, status: 'idle',
        watchToken: null, watchConnected: false, watchLastSeenAt: null, watchStatus: 'idle',
      },
    } as never,
  });
}

describe('HRZoneBar Garmin attribution wiring', () => {
  it('shows "Powered by Garmin" when a heart rate is live and the source is Garmin', () => {
    render(
      <Provider store={buildStore(72, 'garmin')}>
        <MemoryRouter><HRZoneBar /></MemoryRouter>
      </Provider>,
    );
    expect(screen.getByText(/powered by garmin/i)).toBeInTheDocument();
  });

  it('does not show Garmin attribution for a non-Garmin biometric source', () => {
    render(
      <Provider store={buildStore(72, 'health_connect')}>
        <MemoryRouter><HRZoneBar /></MemoryRouter>
      </Provider>,
    );
    expect(screen.queryByText(/powered by garmin/i)).not.toBeInTheDocument();
  });

  it('does not show Garmin attribution when there is no heart rate yet', () => {
    render(
      <Provider store={buildStore(null, 'garmin')}>
        <MemoryRouter><HRZoneBar /></MemoryRouter>
      </Provider>,
    );
    expect(screen.queryByText(/powered by garmin/i)).not.toBeInTheDocument();
  });
});
