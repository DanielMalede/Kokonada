import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../store';
import { setPlaying, skipTrack as skipTrackAction } from '../../store/slices/playerSlice';
import { audioPlayer } from '../../services/audioPlayer';
import { useSocket } from '../../hooks/useSocket';

export default function LivePlayer() {
  const dispatch = useDispatch<AppDispatch>();
  const { skipTrack } = useSocket();
  const { playbackMode, playlist, currentIndex, isPlaying } = useSelector(
    (s: RootState) => s.player
  );
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setProgress(0);
  }, [currentIndex]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      const info = audioPlayer.getPlaybackInfo();
      if (info) setProgress(info.elapsed / info.duration);
    }, 250);
    return () => clearInterval(id);
  }, [isPlaying, currentIndex]);

  if (playbackMode !== 'live' || playlist.length === 0) return null;

  const track = playlist[currentIndex];

  const handlePlay = () => {
    audioPlayer.play(track.uri);
    dispatch(setPlaying(true));
  };

  const handlePause = () => {
    audioPlayer.stop();
    dispatch(setPlaying(false));
  };

  const handleSkip = () => {
    const next = currentIndex + 1;
    if (next < playlist.length) {
      audioPlayer.crossfadeTo(playlist[next].uri);
      dispatch(skipTrackAction());
      skipTrack();
    }
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
            onClick={isPlaying ? handlePause : handlePlay}
            className="bg-[#e63946] hover:opacity-80 text-white rounded-full w-9 h-9 flex items-center justify-center transition-opacity"
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
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
