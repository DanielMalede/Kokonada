import { describe, it, expect } from 'vitest';
import type { RootState } from '../store';
import integrationsReducer, {
  setMusicProvider,
  clearIntegrations,
  selectIsIntegrationsComplete,
} from '../store/slices/integrationsSlice';

const initial = { musicProvider: null, biometricProvider: null, status: 'idle' as const };

describe('integrationsSlice', () => {
  it('sets music provider', () => {
    const state = integrationsReducer(initial, setMusicProvider('spotify'));
    expect(state.musicProvider).toBe('spotify');
  });

  it('clears integrations', () => {
    const populated = { musicProvider: 'spotify' as const, biometricProvider: 'garmin' as const, status: 'idle' as const };
    const state = integrationsReducer(populated, clearIntegrations());
    expect(state.musicProvider).toBeNull();
    expect(state.biometricProvider).toBeNull();
  });

  it('selectIsIntegrationsComplete returns false when either is null', () => {
    const rootState = { integrations: { musicProvider: 'spotify', biometricProvider: null, status: 'idle' } } as unknown as RootState;
    expect(selectIsIntegrationsComplete(rootState)).toBe(false);
  });

  it('selectIsIntegrationsComplete returns true when both set', () => {
    const rootState = { integrations: { musicProvider: 'spotify', biometricProvider: 'garmin', status: 'idle' } } as unknown as RootState;
    expect(selectIsIntegrationsComplete(rootState)).toBe(true);
  });
});
