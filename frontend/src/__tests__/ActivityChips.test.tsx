import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, { setActivity } from '../store/slices/emotionSlice';
import ActivityChips from '../components/ActivityChips';
import { ACTIVITIES } from '../lib/activities';

function makeStore() {
  return configureStore({
    reducer: { emotion: emotionReducer },
    preloadedState: { emotion: { taps: [], textPrompt: '', activity: null } },
  });
}

describe('ActivityChips (activity selector)', () => {
  let store: ReturnType<typeof makeStore>;

  beforeEach(() => {
    store = makeStore();
  });

  it('renders a chip for every activity preset', () => {
    render(
      <Provider store={store}>
        <ActivityChips />
      </Provider>,
    );
    for (const activity of ACTIVITIES) {
      expect(screen.getByRole('radio', { name: activity.label })).toBeInstanceOf(HTMLElement);
    }
  });

  it('selecting an activity stores its key on emotion.activity', () => {
    render(
      <Provider store={store}>
        <ActivityChips />
      </Provider>,
    );
    const running = ACTIVITIES.find((a) => a.key === 'running')!;
    fireEvent.click(screen.getByRole('radio', { name: running.label }));

    expect(store.getState().emotion.activity).toBe('running');
  });

  it('re-selecting the active activity clears it (null)', () => {
    render(
      <Provider store={store}>
        <ActivityChips />
      </Provider>,
    );
    const cooking = ACTIVITIES.find((a) => a.key === 'cooking')!;
    const chip = screen.getByRole('radio', { name: cooking.label });
    fireEvent.click(chip);
    expect(store.getState().emotion.activity).toBe('cooking');
    fireEvent.click(chip);
    expect(store.getState().emotion.activity).toBeNull();
  });
});

describe('emotionSlice — setActivity', () => {
  it('sets the activity key', () => {
    const initial = { taps: [], textPrompt: '', activity: null };
    const state = emotionReducer(initial, setActivity('studying'));
    expect(state.activity).toBe('studying');
  });

  it('clears the activity when set to null', () => {
    const initial = { taps: [], textPrompt: '', activity: 'studying' };
    const state = emotionReducer(initial, setActivity(null));
    expect(state.activity).toBeNull();
  });
});
