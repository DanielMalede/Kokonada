import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../../store';
import { setTextPrompt } from '../../store/slices/emotionSlice';
import { setPlaybackMode } from '../../store/slices/playerSlice';
import { useSocket } from '../../hooks/useSocket';
import PlaybackModeModal from '../PlaybackModeModal';

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
    <div className="bg-[#16213e] rounded-xl p-6 shadow-lg flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-0">Context</h2>
      <textarea
        className="bg-white/5 border border-white/15 focus:border-[#e9c46a] text-gray-100 rounded-lg px-3 py-2 placeholder:text-gray-500 outline-none w-full resize-y"
        rows={3}
        placeholder="Describe your context… e.g. 'Need to focus on studying'"
        value={textPrompt}
        onChange={(e) => dispatch(setTextPrompt(e.target.value))}
      />
      <button
        className="bg-[#e63946] hover:opacity-85 text-white font-semibold px-4 py-2 rounded-lg transition-opacity disabled:opacity-40 disabled:cursor-not-allowed self-start"
        onClick={handleGenerate}
        disabled={buttonDisabled}
        title={noTaps ? 'Place at least one emotion tap first' : undefined}
      >
        Generate Playlist
      </button>
      {status === 'requested' && (
        <p className="text-green-400 text-sm mt-2">Playlist request sent ✓</p>
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
