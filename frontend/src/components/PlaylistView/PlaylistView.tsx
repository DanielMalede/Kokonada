import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { useSocket } from '../../hooks/useSocket';
import { AudioPlayerService } from '../../services/audioPlayer';

export default function PlaylistView() {
  const playlist = useSelector((state: RootState) => state.player.playlist);
  const offlineBuffer = useSelector((state: RootState) => state.player.offlineBuffer);
  const currentIndex = useSelector((state: RootState) => state.player.currentIndex);
  const isPlaying = useSelector((state: RootState) => state.player.isPlaying);
  const isOnline = useSelector((state: RootState) => state.player.isOnline);
  const pendingPlaylist = useSelector((state: RootState) => state.player.pendingPlaylist);
  const { skipTrack } = useSocket();
  const player = AudioPlayerService.getInstance();

  const displayList = isOnline ? playlist : offlineBuffer;
  const current = displayList[currentIndex] ?? null;

  const handlePlay = async () => {
    if (current?.uri) {
      await player.play(current.uri);
    }
  };

  const handleSkip = async () => {
    if (displayList.length < 2) return;
    const nextIndex = (currentIndex + 1) % displayList.length;
    const nextTrack = displayList[nextIndex];
    if (nextTrack?.uri) {
      await player.crossfadeTo(nextTrack.uri);
    }
    skipTrack();
  };

  if (displayList.length === 0) {
    return (
      <div className="bg-[#16213e] rounded-xl p-6 shadow-lg flex items-center justify-center min-h-20">
        <p className="text-gray-500 text-sm text-center">
          {!isOnline
            ? 'Offline — no buffered tracks available.'
            : 'Set your emotion and hit Generate Playlist to start.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-[#16213e] rounded-xl p-6 shadow-lg">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Playlist</h2>
      {!isOnline && (
        <div className="bg-[#e63946] text-white text-center text-xs px-3 py-1.5 rounded mb-3">
          Offline — playing buffered tracks
        </div>
      )}
      {pendingPlaylist.length > 0 && (
        <p className="mb-3 text-xs text-[#e9c46a]">
          ♥ New heart-rate mix queued — starts after this track
        </p>
      )}
      <ul className="list-none m-0 p-0 flex flex-col mb-3">
        {displayList.map((track, i) => (
          <li
            key={track.id}
            className={`flex justify-between items-center py-2 border-b border-white/10 ${
              i === currentIndex ? 'text-[#e9c46a] font-medium' : 'text-gray-300'
            }`}
          >
            <span className="truncate flex-1 text-sm">{track.title}</span>
            <span className="text-gray-500 text-sm ml-2 shrink-0"> — {track.artist}</span>
          </li>
        ))}
      </ul>
      {current && (
        <div className="flex gap-2 mt-3">
          <button
            className="border border-white/30 text-gray-200 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handlePlay}
            disabled={isPlaying}
          >
            {isPlaying ? 'Playing' : 'Play'}
          </button>
          <button
            className="border border-white/30 text-gray-200 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handleSkip}
            disabled={displayList.length < 2}
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
