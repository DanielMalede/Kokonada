import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { sanitizePrompt, sanitizeActivity } from '../../experience/generate/promptSanitizer';

// COLD LANE — committed user intent. The only lane that survives an app restart.
// Shape is the sealed backend contract: taps ({x,y} circumplex), activity key,
// free-text prompt. Backend `emotion_update` reads exactly this.

export interface Tap {
  x: number;
  y: number;
}

export interface EmotionState {
  taps: Tap[];
  activity: string | null;
  textPrompt: string;
}

const MAX_TAPS = 3;

const initialState: EmotionState = { taps: [], activity: null, textPrompt: '' };

const emotionSlice = createSlice({
  name: 'emotion',
  initialState,
  reducers: {
    addTap(state, action: PayloadAction<Tap>) {
      state.taps.push(action.payload);
      if (state.taps.length > MAX_TAPS) state.taps = state.taps.slice(-MAX_TAPS);
    },
    // §5 quiet remove: pop the most-recent tap (undo). No-op on an empty buffer so it can
    // only ever SHRINK the ≤3-tap ring — never a setTaps that could exceed the contract cap.
    undoTap(state) {
      if (state.taps.length > 0) state.taps.pop();
    },
    // §5 forgiving clear: empty the taps ONLY. Deliberately NOT resetEmotion — activity and
    // the free-text prompt are committed intent that a "clear the dots" gesture must preserve
    // (resetEmotion wipes all three and is reserved for logout / rehydrate).
    clearTaps(state) {
      state.taps = [];
    },
    setActivity(state, action: PayloadAction<string | null>) {
      state.activity = action.payload;
    },
    setTextPrompt(state, action: PayloadAction<string>) {
      // Sanitize in the reducer: state AND the persisted MMKV blob are the store's
      // responsibility, so a 50k paste or a null byte can never bloat/poison either.
      state.textPrompt = sanitizePrompt(action.payload);
    },
    hydrate(state, action: PayloadAction<Partial<EmotionState>>) {
      return { ...state, ...action.payload };
    },
    resetEmotion() {
      return { taps: [], activity: null, textPrompt: '' };
    },
  },
});

export const { addTap, undoTap, clearTaps, setActivity, setTextPrompt, hydrate, resetEmotion } = emotionSlice.actions;
export default emotionSlice.reducer;

// ── Persist transform: a HARD allowlist ──────────────────────────────────────
// Serialization and (critically) deserialization both project onto exactly these
// keys, coercing types. A tampered or stale persisted blob cannot inject a
// biometric field, a privilege flag, or a prototype-pollution payload, and cannot
// grow the tap buffer past the contract cap.

const PERSIST_KEYS = ['taps', 'activity', 'textPrompt'] as const;

function sanitizeTaps(value: unknown): Tap[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is Tap => !!t && typeof t === 'object'
      && typeof (t as any).x === 'number' && Number.isFinite((t as any).x)
      && typeof (t as any).y === 'number' && Number.isFinite((t as any).y))
    .slice(-MAX_TAPS)
    .map((t) => ({ x: t.x, y: t.y }));
}

export function serializeForPersist(state: EmotionState): string {
  return JSON.stringify({
    taps: state.taps,
    activity: state.activity,
    textPrompt: state.textPrompt,
  });
}

export function deserializeForPersist(raw: string): Partial<EmotionState> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  // Reject non-plain-object roots (arrays, null, primitives) — nothing to trust.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const src = parsed as Record<string, unknown>;
  const out: Partial<EmotionState> = {};
  for (const key of PERSIST_KEYS) {
    // Only own enumerable allowlisted keys — never __proto__ or inherited props.
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    if (key === 'taps') out.taps = sanitizeTaps(src.taps);
    else if (key === 'activity') out.activity = sanitizeActivity(src.activity);
    else if (key === 'textPrompt') out.textPrompt = sanitizePrompt(src.textPrompt);
  }
  return out;
}
