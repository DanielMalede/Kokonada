import { haptics, type HapticKey } from './tokens';

// Fire a curated haptic by its semantic token. Haptics are non-essential confirmation feedback:
// the native module may be unavailable (jest, an unsupported device, a system "silent" setting), so
// this is a best-effort silent no-op that NEVER throws into a render or tap handler. The module is
// required lazily so its absence is caught here rather than at import time.
export function fireHaptic(key: HapticKey): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod: any = require('react-native-haptic-feedback');
    const trigger: ((type: string) => void) | undefined = mod?.trigger ?? mod?.default?.trigger;
    trigger?.(haptics[key]);
  } catch {
    /* haptics are non-essential — a failure must never surface */
  }
}
