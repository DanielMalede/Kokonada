import { useSelector } from 'react-redux';
import type { RootState } from '../../store';
import { useSocket } from '../../hooks/useSocket';
import './PlaylistView.css';

export default function PlaylistView() {
  const { playlist, currentIndex, isPlaying } = useSelector(
    (state: RootState) => state.player,
  );
  const { skipTrack } = useSocket();

  if (playlist.length === 0) {
    return (
      <div className="playlist-view playlist-view--empty">
        <p>No playlist yet — set your emotion and hit Generate.</p>
      </div>
    );
  }

  return (
    <div className="playlist-view">
      <ul className="playlist-view__list">
        {playlist.map((track, index) => {
          const isCurrent = index === currentIndex;
          return (
            <li
              key={track.id}
              className={`playlist-view__item${isCurrent ? ' playlist-view__item--current' : ''}`}
            >
              <span className="playlist-view__track">
                {track.artist} — {track.title}
              </span>
              {isCurrent && (
                <button className="playlist-view__skip" onClick={skipTrack}>
                  ⏭ Skip
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="playlist-view__status">
        {isPlaying ? '🎵 Playing' : '⏸ Paused'}
      </p>
    </div>
  );
}
