import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from './store';
import { setUser, setAuthStatus } from './store/slices/authSlice';
import { selectIsIntegrationsComplete } from './store/slices/integrationsSlice';
import LoginPage from './pages/LoginPage';
import AppPage from './pages/AppPage';
import IntegrationsPage from './pages/IntegrationsPage';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

function AppBootstrap({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((s: RootState) => s.auth.status);

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

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1a1a2e]">
      <div className="w-10 h-10 border-4 border-[#e9c46a] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AuthGuard() {
  const status = useSelector((s: RootState) => s.auth.status);
  if (status === 'loading') return <Spinner />;
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
  if (status === 'loading') return <Spinner />;
  if (status === 'authenticated') {
    return complete ? <Navigate to="/app" replace /> : <Navigate to="/integrations" replace />;
  }
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
        children: [{ path: '/', element: <LoginPage /> }],
      },
      {
        element: <AuthGuard />,
        children: [
          { path: '/integrations', element: <IntegrationsPage /> },
          {
            element: <IntegrationsGuard />,
            children: [{ path: '/app', element: <AppPage /> }],
          },
        ],
      },
    ],
  },
]);
