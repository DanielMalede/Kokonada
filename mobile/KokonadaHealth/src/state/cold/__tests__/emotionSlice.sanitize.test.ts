// The cold slice is the single source of truth AND the thing that gets persisted to
// MMKV. So sanitization must live IN the reducer, not just in the UI — otherwise a
// direct dispatch (or a tampered persisted blob) bloats state and disk. A 50k-char
// prompt must never enter the store or the persisted blob.

import reducer, {
  setTextPrompt, deserializeForPersist, serializeForPersist,
  type EmotionState,
} from '../emotionSlice';
import { MAX_PROMPT_LENGTH } from '../../../experience/generate/promptSanitizer';

const initial: EmotionState = reducer(undefined, { type: '@@INIT' });

describe('emotionSlice — setTextPrompt sanitizes in the reducer', () => {
  it('caps a 50,000-char dispatched prompt to the max length', () => {
    const s = reducer(initial, setTextPrompt('x'.repeat(50_000)));
    expect(s.textPrompt.length).toBe(MAX_PROMPT_LENGTH);
  });

  it('strips null/control bytes on dispatch', () => {
    const s = reducer(initial, setTextPrompt('rai\0ny\x01 day'));
    expect(s.textPrompt).toBe('rainy day');
  });

  it('preserves spaces on live input — words never glue together (Bug 2)', () => {
    // The reducer runs on EVERY keystroke; a live .trim() strips the trailing space
    // before the next letter, so "hello world" collapses to "helloworld". Live sanitize
    // must keep both internal AND in-progress trailing spaces verbatim.
    expect(reducer(initial, setTextPrompt('hello world foo')).textPrompt).toBe('hello world foo');
    expect(reducer(initial, setTextPrompt('hello ')).textPrompt).toBe('hello ');
  });

  it('the persisted blob of an overflow prompt is bounded (no MMKV bloat)', () => {
    const s = reducer(initial, setTextPrompt('z'.repeat(50_000)));
    const blob = serializeForPersist(s);
    expect(blob.length).toBeLessThan(MAX_PROMPT_LENGTH + 100); // ~cap + json overhead
  });
});

describe('emotionSlice — deserialize sanitizes a tampered/oversized persisted prompt', () => {
  it('caps a planted 50k-char textPrompt from a poisoned MMKV blob', () => {
    const poisoned = JSON.stringify({ taps: [], activity: null, textPrompt: 'q'.repeat(50_000) });
    const out = deserializeForPersist(poisoned);
    expect((out.textPrompt ?? '').length).toBe(MAX_PROMPT_LENGTH);
  });

  it('strips control bytes from a planted persisted prompt', () => {
    const poisoned = JSON.stringify({ textPrompt: 'be\0ep\x1f' });
    const out = deserializeForPersist(poisoned);
    expect(out.textPrompt).toBe('beep');
  });
});
