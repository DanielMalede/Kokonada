import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from './store';
import { setUser, setAuthStatus } from './store/slices/authSlice';
import LoginPage from './pages/LoginPage';
import AppPage from './pages/AppPage';
import './App.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

export default function App() {
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((state: RootState) => state.auth.status);

  useEffect(() => {
    dispatch(setAuthStatus('loading'));
    fetch(`${BACKEND_URL}/api/auth/me`, { credentials: 'include' })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('not authenticated');
      })
      .then((data) => {
        dispatch(setUser(data));
        dispatch(setAuthStatus('authenticated'));
      })
      .catch(() => {
        dispatch(setAuthStatus('idle'));
      });
  }, [dispatch]);

  if (status === 'loading') {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading…</div>;
  }

  if (status === 'authenticated') {
    return <AppPage />;
  }

  return <LoginPage />;
}
