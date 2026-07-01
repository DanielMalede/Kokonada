import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'sonner';
import type { AppDispatch, RootState } from '@/store';
import {
  setMusicProvider,
  setBiometricProvider,
  clearIntegrations,
} from '@/store/slices/integrationsSlice';
import { clearUser } from '@/store/slices/authSlice';
import { disconnectProvider, logout as apiLogout, deleteAccount as apiDeleteAccount } from '@/lib/api';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

export type DisconnectKind = 'spotify' | 'youtube' | 'garmin';

const LABELS: Record<DisconnectKind, string> = {
  spotify: 'Spotify',
  youtube: 'YouTube Music',
  garmin: 'Garmin',
};

/**
 * Shared connection management for the Integrations and Settings pages: disconnect
 * a provider (revoke its token, keep the profile) or sign out of Kokonada entirely.
 * Keeps Redux + toasts consistent across both surfaces.
 */
export function useConnections() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const music = useSelector((s: RootState) => s.integrations.musicProvider);
  const biometric = useSelector((s: RootState) => s.integrations.biometricProvider);

  const disconnect = useCallback(
    async (kind: DisconnectKind) => {
      try {
        await disconnectProvider(BACKEND_URL, kind);
        // Clear the matching connection so the UI flips back to "connect".
        if (kind === 'garmin') dispatch(setBiometricProvider(null));
        else dispatch(setMusicProvider(null));
        toast.success(`${LABELS[kind]} disconnected.`);
      } catch {
        toast.error(`Couldn't disconnect ${LABELS[kind]} — please try again.`);
      }
    },
    [dispatch],
  );

  const signOut = useCallback(async () => {
    // apiLogout best-effort revokes the JWT server-side and always clears the
    // local token, so we're signed out even if the network call fails.
    await apiLogout(BACKEND_URL);
    dispatch(clearUser());
    dispatch(clearIntegrations());
    navigate('/', { replace: true }); // PublicOnlyGuard → LoginPage
    toast.success('Signed out.');
  }, [dispatch, navigate]);

  const deleteAccount = useCallback(async () => {
    // Unlike signOut, this must NOT swallow server errors — if the delete fails the
    // account still exists, so we surface an error and keep the user signed in. Only
    // on a confirmed server-side erasure do we clear local state and leave.
    try {
      await apiDeleteAccount(BACKEND_URL);
    } catch {
      toast.error("Couldn't delete your account — please try again.");
      return;
    }
    dispatch(clearUser());
    dispatch(clearIntegrations());
    navigate('/', { replace: true });
    toast.success('Your account and all associated data were permanently deleted.');
  }, [dispatch, navigate]);

  return { music, biometric, disconnect, signOut, deleteAccount };
}
