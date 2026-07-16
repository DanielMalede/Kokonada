import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Play, Pause, ChevronUp } from 'lucide-react';
import type { RootState } from '@/store';
import { spotifyPlayerService } from '@/services/spotifyPlayer';
import { cn } from '@/lib/utils';
import SpotifyAttribution from '@/components/SpotifyAttribution';

/**
 * Compact persistent mini-player. Appears above the mobile nav and at the foot
 * of the desktop sidebar whenever a live playlist is active. Tapping the body
 * opens the full-screen Now Playing route.
 */
export default function NowPlayingBar({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { playlist, offlineBuffer, currentIndex, isOnline, playbackMode, sdkIsPaused } =
    useSelector((s: RootState) => s.player);

  const list = isOnline ? playlist : offlineBuffer;
  const track = list[currentIndex];
  if (!track || playbackMode !== 'live') return null;

  const toggle = () => {
    if (sdkIsPaused) spotifyPlayerService.resume().catch(console.error);
    else spotifyPlayerService.pause().catch(console.error);
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl bg-card/90 px-3 py-2 ring-1 ring-foreground/10 backdrop-blur-xl shadow-lg',
        className,
      )}
    >
      <button
        onClick={() => navigate('/now-playing')}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label="Open now playing"
      >
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-linear-to-br from-(--aura-a) to-(--aura-b) text-primary-foreground">
          <ChevronUp className="size-4 opacity-80" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{track.title}</p>
          <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
        </div>
      </button>
      {/* Spotify Design Guidelines: any surface showing Spotify metadata during
          playback must carry the mark + a link back to the content. Renders
          nothing for non-Spotify tracks (gated inside the component). */}
      <SpotifyAttribution uri={track.uri} compact />
      <button
        onClick={toggle}
        aria-label={sdkIsPaused ? 'Play' : 'Pause'}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-95"
      >
        {sdkIsPaused ? <Play className="size-4 translate-x-px" /> : <Pause className="size-4" />}
      </button>
    </div>
  );
}
