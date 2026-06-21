import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../../store';
import { skipTrack as skipTrackAction } from '../../store/slices/playerSlice';
import { spotifyPlayerService } from '../../services/spotifyPlayer';
import { useSocket } from '../../hooks/useSocket';

export default function LivePlayer() {
  const dispatch = useDispatch<AppDispatch>();
  const { skipTrack } = useSocket();
  const {
    playbackMode, playlist, currentIndex,
    sdkIsPaused, sdkPositionMs, sdkDurationMs,
  } = useSelector((s: RootState) => s.player);

  if (playbackMode !== 'live' || playlist.length === 0) return null;

  const track = playlist[currentIndex];
  const progress = sdkDurationMs > 0 ? sdkPositionMs / sdkDurationMs : 0;

  const handlePlay = () => { spotifyPlayerService.resume().catch(console.error); };
  const handlePause = () => { spotifyPlayerService.pause().catch(console.error); };
  const handleSkip = () => {
    spotifyPlayerService.nextTrack().catch(console.error);
    dispatch(skipTrackAction());
    skipTrack();
  };

  return (
    <div className="bg-[#16213e] rounded-xl p-5 shadow-lg mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1 min-w-0 mr-3">
          <p className="text-white font-semibold text-sm truncate">{track.title}</p>
          <p className="text-gray-400 text-xs truncate">{track.artist}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            aria-label={sdkIsPaused ? 'Play' : 'Pause'}
            onClick={sdkIsPaused ? handlePlay : handlePause}
            className="bg-[#e63946] hover:opacity-80 text-white rounded-full w-9 h-9 flex items-center justify-center transition-opacity"
          >
            {sdkIsPaused ? '▶' : '⏸'}
          </button>
          <button
            aria-label="Skip"
            onClick={handleSkip}
            disabled={currentIndex + 1 >= playlist.length}
            className="border border-white/20 hover:bg-white/10 disabled:opacity-30 text-white rounded-full w-9 h-9 flex items-center justify-center transition-colors"
          >
            ⏭
          </button>
        </div>
      </div>
      <div className="w-full bg-white/10 rounded-full h-1">
        <div
          className="bg-[#e9c46a] h-1 rounded-full transition-[width] duration-200"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}
