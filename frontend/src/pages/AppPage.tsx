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
    <div className="min-h-screen bg-[#1a1a2e]">
      <header className="bg-[#0f3460] px-6 py-3 flex justify-between items-center">
        <span className="text-xl font-bold text-[#e9c46a]">Kokonada</span>
        <div className="flex items-center gap-3">
          {user?.avatarUrl && (
            <img className="w-8 h-8 rounded-full object-cover" src={user.avatarUrl} alt={user.displayName} />
          )}
          <span className="text-sm text-gray-200">{user?.displayName}</span>
          <button
            className="border border-white/30 text-gray-200 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </header>
      <main className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 max-w-6xl mx-auto">
        <div className="flex flex-col gap-4">
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
        <div className="flex flex-col gap-4">
          <EmotionCircle />
          <PlaylistView />
          <LivePlayer />
        </div>
      </main>
    </div>
  );
}
