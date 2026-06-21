import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../../store';
import { setTextPrompt } from '../../store/slices/emotionSlice';
import { setPlaybackMode } from '../../store/slices/playerSlice';
import { useSocket } from '../../hooks/useSocket';
import PlaybackModeModal from '../PlaybackModeModal';
import './ContextPrompt.css';

type Status = 'idle' | 'requested';

export default function ContextPrompt() {
  const dispatch = useDispatch<AppDispatch>();
  const textPrompt = useSelector((state: RootState) => state.emotion.textPrompt);
  const taps = useSelector((state: RootState) => state.emotion.taps);
  const { emitEmotionUpdate } = useSocket();
  const [status, setStatus] = useState<Status>('idle');
  const [modalOpen, setModalOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const handleGenerate = () => {
    setModalOpen(true);
  };

  const noTaps = taps.length === 0;
  const buttonDisabled = noTaps || status === 'requested';

  return (
    <div className="context-prompt">
      <textarea
        className="context-prompt__textarea"
        rows={3}
        placeholder="Describe your context… e.g. 'Need to focus on studying'"
        value={textPrompt}
        onChange={(e) => dispatch(setTextPrompt(e.target.value))}
      />
      <button
        className="context-prompt__button"
        onClick={handleGenerate}
        disabled={buttonDisabled}
        title={noTaps ? 'Place at least one emotion tap first' : undefined}
      >
        Generate Playlist
      </button>
      {status === 'requested' && (
        <p className="context-prompt__confirmation">Playlist request sent ✓</p>
      )}
      <PlaybackModeModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={(mode) => {
          emitEmotionUpdate(taps, textPrompt, mode);
          dispatch(setPlaybackMode(mode));
          setStatus('requested');
          timerRef.current = setTimeout(() => setStatus('idle'), 3000);
          setModalOpen(false);
        }}
      />
    </div>
  );
}
