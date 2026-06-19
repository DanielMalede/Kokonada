import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { useSocket } from '../../hooks/useSocket';
import { AudioPlayerService } from '../../services/audioPlayer';
import './PlaylistView.css';

export default function PlaylistView() {
  const playlist = useSelector((state: RootState) => state.player.playlist);
  const offlineBuffer = useSelector((state: RootState) => state.player.offlineBuffer);
  const currentIndex = useSelector((state: RootState) => state.player.currentIndex);
  const isPlaying = useSelector((state: RootState) => state.player.isPlaying);
  const isOnline = useSelector((state: RootState) => state.player.isOnline);
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
      <div className="playlist-view playlist-view--empty">
        {!isOnline ? (
          <p>Offline — no buffered tracks available.</p>
        ) : (
          <p>Set your emotion and hit Generate Playlist to start.</p>
        )}
      </div>
    );
  }

  return (
    <div className="playlist-view">
      {!isOnline && (
        <div className="playlist-view__offline-banner">Offline — playing buffered tracks</div>
      )}
      <ul className="playlist-view__list">
        {displayList.map((track, i) => (
          <li
            key={track.id}
            className={`playlist-view__track${i === currentIndex ? ' playlist-view__track--current' : ''}`}
          >
            <span className="playlist-view__title">{track.title}</span>
            <span className="playlist-view__artist"> — {track.artist}</span>
          </li>
        ))}
      </ul>
      {current && (
        <div className="playlist-view__controls">
          <button className="playlist-view__btn" onClick={handlePlay} disabled={isPlaying}>
            {isPlaying ? 'Playing' : 'Play'}
          </button>
          <button className="playlist-view__btn" onClick={handleSkip} disabled={displayList.length < 2}>
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
