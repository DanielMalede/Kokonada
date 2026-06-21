interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (mode: 'live' | 'export') => void;
}

export default function PlaybackModeModal({ isOpen, onClose, onSelect }: Props) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center z-50 p-4">
      <div className="bg-[#16213e] rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-xl font-bold text-white mb-1">How should we play this?</h2>
        <p className="text-gray-400 text-sm mb-6">Choose how you want to receive your generated playlist.</p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => onSelect('export')}
            className="flex items-center gap-4 bg-[#0f3460] hover:bg-[#0f3460]/80 text-white rounded-xl p-4 transition-colors text-left"
          >
            <span className="text-3xl">💾</span>
            <div>
              <div className="font-semibold">Export & Save</div>
              <div className="text-sm text-gray-400">Saves playlist directly to your Spotify / YouTube account</div>
            </div>
          </button>
          <button
            onClick={() => onSelect('live')}
            className="flex items-center gap-4 bg-[#e63946]/10 border border-[#e63946]/40 hover:bg-[#e63946]/20 text-white rounded-xl p-4 transition-colors text-left"
          >
            <span className="text-3xl">🎧</span>
            <div>
              <div className="font-semibold text-[#e63946]">Listen Live</div>
              <div className="text-sm text-gray-400">Stream in-browser with real-time biometric updates</div>
            </div>
          </button>
        </div>
        <button onClick={onClose} className="mt-4 w-full text-gray-500 hover:text-gray-300 text-sm py-2 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}
