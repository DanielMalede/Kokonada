import { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../store';
import { clearUser, setAuthStatus } from '../store/slices/authSlice';
import { addTap } from '../store/slices/emotionSlice';
import { useSocket } from '../hooks/useSocket';
import ActivityPanel from '../components/ActivityPanel';
import ContextPrompt from '../components/ContextPrompt';
import EmotionCircle from '../components/EmotionCircle';
import PlaylistView from '../components/PlaylistView';
import LivePlayer from '../components/LivePlayer';
import './AppPage.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

export default function AppPage() {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector((state: RootState) => state.auth.user);
  const taps = useSelector((state: RootState) => state.emotion.taps);
  const { disconnect, emitEmotionUpdate } = useSocket();

  // Disconnect the singleton socket when AppPage unmounts (i.e. on logout).
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const handleLogout = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // network failure — still clear client-side auth so user is never stuck
    } finally {
      dispatch(clearUser());
      dispatch(setAuthStatus('idle'));
    }
  };

  return (
    <div>
      <header className="app-header">
        <span className="app-header__title">Kokonada</span>
        <div className="app-header__user">
          {user?.avatarUrl && (
            <img className="app-header__avatar" src={user.avatarUrl} alt={user.displayName} />
          )}
          <span className="app-header__display-name">{user?.displayName}</span>
          <button className="app-header__logout" onClick={handleLogout}>
            Logout
          </button>
        </div>
      </header>
      <main className="app-main">
        <div className="app-column">
          <ActivityPanel />
          <button
            onClick={() => {
              dispatch(addTap({ x: 0, y: 0 }));
              emitEmotionUpdate([...taps, { x: 0, y: 0 }]);
            }}
            disabled={taps.length >= 3}
            className="w-full border border-[#e9c46a]/40 text-[#e9c46a] hover:bg-[#e9c46a]/10 disabled:opacity-30 disabled:cursor-not-allowed py-2 rounded-lg transition-colors text-sm font-medium"
          >
            Neutral / Skip
          </button>
          <ContextPrompt />
        </div>
        <div className="app-column">
          <EmotionCircle />
          <PlaylistView />
          <LivePlayer />
        </div>
      </main>
    </div>
  );
}
