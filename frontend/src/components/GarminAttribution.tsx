import { useSelector } from 'react-redux';
import type { RootState } from '@/store';
import { cn } from '@/lib/utils';

/**
 * Garmin API Brand Guidelines require a "Garmin [device]" / "Powered by Garmin"
 * attribution on every screen that displays Garmin-sourced biometric data (heart
 * rate, HRV, Body Battery, etc.) — detail views, dashboards/summary cards, and
 * secondary screens all count. Non-compliance risks suspension/termination of
 * API access (developer.garmin.com/brand-guidelines/api-brand-guidelines/).
 *
 * Renders nothing unless the user's CONNECTED biometric source is actually Garmin
 * — Apple Health / Health Connect / mood-only users must never see a false
 * attribution. We render the generic "Powered by Garmin" form (not a specific
 * "Garmin [device model]" string) because no per-device model is currently
 * captured from the Health API ingestion path; once device metadata is plumbed
 * through (see backend/app/services/wearable/garmin.js), this can be upgraded to
 * name the exact device without changing any call site.
 */
export default function GarminAttribution({ className }: { className?: string }) {
  const biometricProvider = useSelector((s: RootState) => s.integrations.biometricProvider);
  if (biometricProvider !== 'garmin') return null;

  return (
    <span
      // text-xs (not an arbitrary bracket value): the same caption treatment
      // SpotifyAttribution's own "Listen on Spotify" label uses, so the two
      // provider attributions read as one consistent visual language.
      className={cn('inline-flex items-center gap-1 text-xs font-medium text-muted-foreground', className)}
    >
      Powered by Garmin
    </span>
  );
}
