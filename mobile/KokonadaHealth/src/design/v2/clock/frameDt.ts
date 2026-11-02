// The one dt law (B4 item 6): the frame clamp is motion.dtClamp in the V1 tokens (designer ruling
// DSN-039), read here and nowhere else, and everything that moves with real time takes the same
// clamped dt: the field clock (fieldClock.ts), the breath, and the placement ledger's crossfades
// (placementLedger.ts). A pure module (no React, no Reanimated), so the ledger stays pure and loads in
// every jest project; fieldClock.ts re-exports both names for its callers.

import { BASE } from '../tokens/tokens.generated.ts';

export const MAX_FRAME_DT_MS = BASE.motion.dtClamp;

/** A frame's dt as the field takes it: at most the clamp; a negative, missing or non-finite dt is 0. */
// The default is resolved in the body, never as a default parameter: the worklets plugin captures only what
// a worklet's body names, so on the UI thread `maxDtMs = MAX_FRAME_DT_MS` threw (workletSafe.test.ts).
export function clampFrameDt(dtMs: number | null | undefined, maxDtMs?: number): number {
  'worklet';
  const max = maxDtMs === undefined ? MAX_FRAME_DT_MS : maxDtMs;
  return typeof dtMs === 'number' && Number.isFinite(dtMs) && dtMs > 0 ? Math.min(dtMs, max) : 0;
}
