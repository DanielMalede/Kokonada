import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from './store';
import { setUser, setAuthStatus } from './store/slices/authSlice';
import { selectIsIntegrationsComplete, setMoodOnly } from './store/slices/integrationsSlice';
import LoginPage from './pages/LoginPage';
import WelcomePage from './pages/WelcomePage';
import IntegrationsPage from './pages/IntegrationsPage';
import AppShell from './components/AppShell';
import AppPage from './pages/AppPage';
import NowPlayingPage from './pages/NowPlayingPage';
import PlaylistHistoryPage from './pages/PlaylistHistoryPage';
import PlaylistDetailPage from './pages/PlaylistDetailPage';
import UserProfilePage from './pages/UserProfilePage';
import SettingsPage from './pages/SettingsPage';
import DiscoverPage from './pages/DiscoverPage';
import SplashScreen from './components/SplashScreen';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

function AppBootstrap({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((s: RootState) => s.auth.status);

  // Restore the client-only "mood only" preference across reloads.
  useEffect(() => {
    if (localStorage.getItem('koko-mood-only') === '1') dispatch(setMoodOnly(true));
  }, [dispatch]);

  useEffect(() => {
    if (status !== 'idle') return;
    dispatch(setAuthStatus('loading'));
    fetch(`${BACKEND_URL}/api/auth/me`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { dispatch(setUser(data)); dispatch(setAuthStatus('authenticated')); })
      .catch(() => dispatch(setAuthStatus('error')));
  }, [dispatch, status]);

  return <>{children}</>;
}

function AuthGuard() {
  const status = useSelector((s: RootState) => s.auth.status);
  if (status === 'loading') return <SplashScreen />;
  if (status === 'idle' || status === 'error') return <Navigate to="/" replace />;
  return <Outlet />;
}

function IntegrationsGuard() {
  const complete = useSelector(selectIsIntegrationsComplete);
  if (!complete) return <Navigate to="/integrations" replace />;
  return <Outlet />;
}

function PublicOnlyGuard() {
  const status = useSelector((s: RootState) => s.auth.status);
  const complete = useSelector(selectIsIntegrationsComplete);
  if (status === 'loading') return <SplashScreen />;
  if (status === 'authenticated') {
    return complete ? <Navigate to="/app" replace /> : <Navigate to="/integrations" replace />;
  }
  return <Outlet />;
}

/** First-time visitors see the welcome flow before the login screen. */
function OnboardingGate() {
  const onboarded = localStorage.getItem('koko-onboarded') === '1';
  if (!onboarded) return <Navigate to="/welcome" replace />;
  return <Outlet />;
}

function RootLayout() {
  return (
    <AppBootstrap>
      <Outlet />
    </AppBootstrap>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        element: <PublicOnlyGuard />,
        children: [
          { path: '/welcome', element: <WelcomePage /> },
          {
            element: <OnboardingGate />,
            children: [{ path: '/', element: <LoginPage /> }],
          },
        ],
      },
      {
        element: <AuthGuard />,
        children: [
          { path: '/integrations', element: <IntegrationsPage /> },
          {
            element: <IntegrationsGuard />,
            children: [
              {
                element: <AppShell />,
                children: [
                  { path: '/app', element: <AppPage /> },
                  { path: '/now-playing', element: <NowPlayingPage /> },
                  { path: '/history', element: <PlaylistHistoryPage /> },
                  { path: '/history/:id', element: <PlaylistDetailPage /> },
                  { path: '/profile', element: <UserProfilePage /> },
                  { path: '/settings', element: <SettingsPage /> },
                  { path: '/discover', element: <DiscoverPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);
