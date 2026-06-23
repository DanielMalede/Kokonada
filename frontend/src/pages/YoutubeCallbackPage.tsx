import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

export default function YoutubeCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code  = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
      navigate(`/integrations?error=youtube_${error}`, { replace: true });
      return;
    }

    if (!code || !state) {
      navigate('/integrations?error=youtube_failed', { replace: true });
      return;
    }

    fetch(`${BACKEND_URL}/api/integrations/youtube/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          navigate('/integrations?music=youtube', { replace: true });
        } else {
          navigate(`/integrations?error=${data.error ?? 'youtube_failed'}`, { replace: true });
        }
      })
      .catch(() => navigate('/integrations?error=youtube_failed', { replace: true }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
      <p style={{ color: 'var(--foreground)', fontFamily: 'sans-serif' }}>
        Connecting YouTube Music…
      </p>
    </div>
  );
}
