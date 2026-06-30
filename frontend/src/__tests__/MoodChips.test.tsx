import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, { addTap, clearTaps } from '../store/slices/emotionSlice';
import MoodChips from '../components/MoodChips';
import { MOODS } from '../lib/moods';

function makeStore() {
  return configureStore({
    reducer: { emotion: emotionReducer },
    preloadedState: { emotion: { taps: [], textPrompt: '', activity: null } },
  });
}

describe('MoodChips (mood-preset emotion input)', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it('renders a chip for every mood preset', () => {
    render(
      <Provider store={store}>
        <MoodChips />
      </Provider>,
    );
    for (const mood of MOODS) {
      expect(screen.getByRole('radio', { name: mood.label })).toBeInstanceOf(HTMLElement);
    }
  });

  it('selecting a mood writes a single {x,y} tap matching that preset', () => {
    render(
      <Provider store={store}>
        <MoodChips />
      </Provider>,
    );
    const focus = MOODS.find((m) => m.key === 'focus')!;
    fireEvent.click(screen.getByRole('radio', { name: focus.label }));

    const taps = store.getState().emotion.taps;
    // Single-select keeps the existing emotion_update payload shape (one tap).
    expect(taps).toHaveLength(1);
    expect(taps[0]).toEqual({ x: focus.x, y: focus.y });
  });

  it('re-selecting the active mood clears the tap', () => {
    render(
      <Provider store={store}>
        <MoodChips />
      </Provider>,
    );
    const energize = MOODS.find((m) => m.key === 'energize')!;
    const chip = screen.getByRole('radio', { name: energize.label });
    fireEvent.click(chip);
    expect(store.getState().emotion.taps).toHaveLength(1);
    fireEvent.click(chip);
    expect(store.getState().emotion.taps).toHaveLength(0);
  });
});

describe('emotionSlice reducer', () => {
  it('addTap adds a tap to the taps array', () => {
    const initial = { taps: [], textPrompt: '', activity: null };
    const state = emotionReducer(initial, addTap({ x: 0, y: 0 }));
    expect(state.taps).toHaveLength(1);
    expect(state.taps[0]).toEqual({ x: 0, y: 0 });
  });

  it('addTap does not exceed 3 taps', () => {
    let state = { taps: [], textPrompt: '', activity: null };
    state = emotionReducer(state, addTap({ x: 0, y: 0 }));
    state = emotionReducer(state, addTap({ x: 1, y: 1 }));
    state = emotionReducer(state, addTap({ x: 2, y: 2 }));
    state = emotionReducer(state, addTap({ x: 3, y: 3 }));
    expect(state.taps).toHaveLength(3);
  });

  it('clearTaps removes all taps', () => {
    const initial = { taps: [{ x: 0, y: 0 }, { x: 1, y: 1 }], textPrompt: '', activity: null };
    const state = emotionReducer(initial, clearTaps());
    expect(state.taps).toHaveLength(0);
  });
});
