import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../store';
import {
  setMusicProvider,
  setBiometricProvider,
  selectIsIntegrationsComplete,
} from '../store/slices/integrationsSlice';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

export default function IntegrationsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const music = useSelector((s: RootState) => s.integrations.musicProvider);
  const biometric = useSelector((s: RootState) => s.integrations.biometricProvider);
  const complete = useSelector(selectIsIntegrationsComplete);

  // Hydrate from backend on mount (handles hard refresh)
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/integrations/status`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        dispatch(setMusicProvider(data.musicProvider));
        dispatch(setBiometricProvider(data.biometricProvider));
      })
      .catch(() => {});
  }, [dispatch]);

  // Read OAuth return params (?music=spotify etc.)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const musicParam = params.get('music') as 'spotify' | 'youtube' | null;
    const biometricParam = params.get('biometric') as 'garmin' | 'applehealth' | null;
    if (musicParam === 'spotify' || musicParam === 'youtube') dispatch(setMusicProvider(musicParam));
    if (biometricParam === 'garmin' || biometricParam === 'applehealth') dispatch(setBiometricProvider(biometricParam));
    if (musicParam || biometricParam) window.history.replaceState({}, '', '/integrations');
  }, [dispatch]);

  const connectSpotify = () => { window.location.href = `${BACKEND_URL}/api/integrations/spotify/connect`; };
  const connectYouTube = () => { window.location.href = `${BACKEND_URL}/api/integrations/youtube/connect`; };
  const connectGarmin = () => { window.location.href = `${BACKEND_URL}/api/integrations/garmin/connect`; };

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <h1 className="text-3xl font-bold text-[#e9c46a] mb-2 text-center">Connect Your Services</h1>
        <p className="text-gray-400 text-center mb-10">Connect a music provider and a biometric provider to continue.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Music Provider Card */}
          <div className="bg-[#16213e] rounded-xl p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">🎵</span>
              <h2 className="text-lg font-semibold text-white">Music Provider</h2>
              {music && <span className="ml-auto text-green-400 text-sm font-medium">✓ Connected</span>}
            </div>
            {music ? (
              <p className="text-gray-400 text-sm capitalize">{music} connected</p>
            ) : (
              <div className="flex flex-col gap-3">
                <button onClick={connectSpotify} className="w-full bg-[#1DB954] hover:opacity-90 text-black font-semibold py-2.5 rounded-lg transition-opacity">
                  Connect Spotify
                </button>
                <button onClick={connectYouTube} className="w-full bg-[#FF0000] hover:opacity-90 text-white font-semibold py-2.5 rounded-lg transition-opacity">
                  Connect YouTube Music
                </button>
              </div>
            )}
          </div>

          {/* Biometric Provider Card */}
          <div className="bg-[#16213e] rounded-xl p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">❤️</span>
              <h2 className="text-lg font-semibold text-white">Biometric Provider</h2>
              {biometric && <span className="ml-auto text-green-400 text-sm font-medium">✓ Connected</span>}
            </div>
            {biometric ? (
              <p className="text-gray-400 text-sm capitalize">{biometric === 'applehealth' ? 'Apple Health' : biometric} connected</p>
            ) : (
              <div className="flex flex-col gap-3">
                <button onClick={connectGarmin} className="w-full bg-[#0f3460] hover:opacity-90 text-white font-semibold py-2.5 rounded-lg transition-opacity border border-white/20">
                  Connect Garmin
                </button>
                <div className="w-full border border-white/10 text-gray-500 text-sm text-center py-2.5 rounded-lg cursor-not-allowed">
                  Apple Health — Mobile App Only
                </div>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => navigate('/app')}
          disabled={!complete}
          className="w-full bg-[#e63946] hover:opacity-85 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-opacity text-lg"
        >
          Continue to App
        </button>
      </div>
    </div>
  );
}
