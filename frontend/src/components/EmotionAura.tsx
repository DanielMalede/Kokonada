import { useEffect } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { auraColors } from '@/lib/moods';

/**
 * Kokonada's signature element. A soft, fixed radial-gradient layer that sits
 * behind every screen and slowly shifts hue to match the user's current mood
 * (selected emotion tap) and heart-rate zone. The actual gradient lives in
 * `.emotion-aura` (index.css); this component just feeds it live colors via
 * the --aura-a / --aura-b custom properties and animates the transition.
 */
export default function EmotionAura() {
  const taps = useSelector((s: RootState) => s.emotion.taps);
  const heartRate = useSelector((s: RootState) => s.biometrics.heartRate);

  useEffect(() => {
    const { a, b } = auraColors(taps, heartRate);
    const root = document.documentElement;
    root.style.setProperty('--aura-a', a);
    root.style.setProperty('--aura-b', b);
  }, [taps, heartRate]);

  return <div className="emotion-aura" aria-hidden="true" />;
}
