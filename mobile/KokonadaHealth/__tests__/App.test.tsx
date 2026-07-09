/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import BootSplash from 'react-native-bootsplash';
import App from '../App';
import { startApp } from '../src/prodBootstrap';

jest.mock('../src/prodBootstrap', () => ({ startApp: jest.fn() }));
const mockStartApp = startApp as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

test('renders correctly', async () => {
  mockStartApp.mockResolvedValue(undefined);
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
  expect(BootSplash.hide).toHaveBeenCalled();
});

test('hides the splash even when startApp rejects', async () => {
  mockStartApp.mockRejectedValue(new Error('bootstrap failed'));
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
  expect(BootSplash.hide).toHaveBeenCalled();
});

test('hides the splash after the deadline when startApp hangs', async () => {
  jest.useFakeTimers();
  mockStartApp.mockReturnValue(new Promise(() => {})); // never settles
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
  expect(BootSplash.hide).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(8000);
  });
  expect(BootSplash.hide).toHaveBeenCalled();
});
