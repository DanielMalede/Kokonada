import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import emotionReducer from '../store/slices/emotionSlice';
import EmotionCircle from '../components/EmotionCircle/EmotionCircle';
import { TextFallback } from '../components/EmotionCircle/TextFallback';

describe('EmotionCircle.coords - Hide raw X/Y coordinates', () => {
  let store: any;

  beforeEach(() => {
    store = configureStore({
      reducer: { emotion: emotionReducer },
      preloadedState: {
        emotion: { taps: [{ x: 0.5, y: 0.3 }], textPrompt: '' },
      },
    });
  });

  it('EmotionCircle aria-label does not expose raw coordinates', () => {
    const { container } = render(
      <Provider store={store}>
        <EmotionCircle />
      </Provider>
    );
    const gEl = container.querySelector('[aria-label*="Emotion tap 1"]') || container.querySelector('g[aria-label]');
    const ariaLabel = gEl?.getAttribute('aria-label');

    expect(ariaLabel).toBeDefined();
    expect(ariaLabel).not.toMatch(/0\.50|0\.30/);
    expect(ariaLabel).toMatch(/Emotion tap 1/);
  });

  it('TextFallback does not expose (X.XX, Y.YY) format', () => {
    const { container } = render(
      <Provider store={store}>
        <TextFallback />
      </Provider>
    );
    const listItems = container.querySelectorAll('li');
    expect(listItems.length).toBeGreaterThan(0);

    const text = listItems[0]?.textContent || '';
    expect(text).not.toMatch(/\(0\.50, 0\.30\)/);
    expect(text).toMatch(/Custom tap 1/);
  });
});
