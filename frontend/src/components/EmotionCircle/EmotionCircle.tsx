import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../../store';
import { addTap, removeTap, clearTaps } from '../../store/slices/emotionSlice';
import { useSocket } from '../../hooks/useSocket';
import { TextFallback } from './TextFallback';
import './EmotionCircle.css';

const CX = 200;
const CY = 200;
const R = 180;

const TAP_COLORS = ['#e63946', '#2a9d8f', '#e9c46a'];

const QUADRANT_LABELS = [
  { label: 'Happy / Excited', dx: 0.7, dy: -0.7 },
  { label: 'Calm / Content', dx: -0.7, dy: -0.7 },
  { label: 'Sad / Depressed', dx: -0.7, dy: 0.7 },
  { label: 'Tense / Angry', dx: 0.7, dy: 0.7 },
] as const;

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function svgToEmotion(px: number, py: number): { x: number; y: number } {
  return {
    x: clamp((px - CX) / R),
    y: clamp(-((py - CY) / R)),
  };
}

function emotionToSvg(x: number, y: number): { px: number; py: number } {
  return {
    px: CX + x * R,
    py: CY - y * R,
  };
}

export default function EmotionCircle() {
  const dispatch = useDispatch<AppDispatch>();
  const taps = useSelector((state: RootState) => state.emotion.taps);
  const { emitEmotionUpdate } = useSocket();

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (taps.length >= 3) return;

    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const viewBoxWidth = 400;
    const viewBoxHeight = 400;
    const scaleX = viewBoxWidth / rect.width;
    const scaleY = viewBoxHeight / rect.height;

    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    const distFromCenter = Math.sqrt((px - CX) ** 2 + (py - CY) ** 2);
    if (distFromCenter > R) return;

    const { x, y } = svgToEmotion(px, py);
    const newTaps = [...taps, { x, y }];
    dispatch(addTap({ x, y }));
    emitEmotionUpdate(newTaps);
  };

  const handleTapClick = (index: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const newTaps = taps.filter((_, i) => i !== index);
    dispatch(removeTap(index));
    emitEmotionUpdate(newTaps);
  };

  const handleClear = () => {
    dispatch(clearTaps());
    emitEmotionUpdate([]);
  };

  const svgCursor = taps.length >= 3 ? 'not-allowed' : 'crosshair';

  return (
    <div className="emotion-circle-wrapper">
      <svg
        viewBox="0 0 400 400"
        width="100%"
        height="auto"
        className="emotion-svg"
        role="img"
        aria-label="Emotion map. Click to place up to 3 emotion taps."
        onClick={handleSvgClick}
        style={{ cursor: svgCursor }}
      >
        <circle
          cx={CX}
          cy={CY}
          r={R}
          className="outer-circle"
        />

        <line
          x1={CX - R}
          y1={CY}
          x2={CX + R}
          y2={CY}
          className="axis-line"
        />
        <line
          x1={CX}
          y1={CY - R}
          x2={CX}
          y2={CY + R}
          className="axis-line"
        />

        {QUADRANT_LABELS.map(({ label, dx, dy }) => {
          const px = CX + dx * R * 0.7;
          const py = CY + dy * R * 0.7;
          return (
            <text key={label} x={px} y={py} className="quadrant-label">
              {label}
            </text>
          );
        })}

        {taps.map((tap, i) => {
          const { px, py } = emotionToSvg(tap.x, tap.y);
          return (
            <g
              key={i}
              onClick={handleTapClick(i)}
              style={{ cursor: 'pointer' }}
              aria-label={`Tap ${i + 1} at arousal ${tap.x.toFixed(2)}, valence ${tap.y.toFixed(2)}. Click to remove.`}
            >
              <circle
                cx={px}
                cy={py}
                r={14}
                fill={TAP_COLORS[i]}
                stroke="#fff"
                strokeWidth={1.5}
              />
              <text x={px} y={py} className="tap-label">
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>

      <button
        className="clear-taps-btn"
        onClick={handleClear}
        disabled={taps.length === 0}
        aria-label="Clear all emotion taps"
      >
        Clear all taps
      </button>

      <TextFallback />
    </div>
  );
}
