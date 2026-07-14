import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';

// SpotifyAttribution + haptics pull native — stub them so this suite is about re-render hygiene only.
jest.mock('../../player/SpotifyAttribution', () => {
  const React2 = require('react');
  const { View } = require('react-native');
  return { SpotifyAttribution: () => React2.createElement(View, { testID: 'spotify-attribution' }) };
});
jest.mock('../../../design/haptics', () => ({ fireHaptic: jest.fn() }));

// A memoized SPY row: it counts how many times a row actually (re-)renders. Because the real UpNextRow
// is React.memo, a cursor-change re-render of the sheet must re-invoke ONLY the two rows whose cursor
// state flipped — not every live row. (L3/V2: list re-render hygiene.)
jest.mock('../UpNextRow', () => {
  const React2 = require('react');
  const { View } = require('react-native');
  const rowSpy = jest.fn((props: any) => React2.createElement(View, { testID: `row-${props.item.id}` }));
  return { __esModule: true, UpNextRow: React2.memo(rowSpy), rowSpy };
});

import { UpNextSheet } from '../UpNextSheet';
import type { QueueTrack } from '../playbackQueue';
const { rowSpy } = require('../UpNextRow') as { rowSpy: jest.Mock };

const TR = (id: string): QueueTrack => ({ id, uri: `spotify:track:${id}`, title: `Title ${id}`, artist: `Artist ${id}`, receipt: null, recordingKey: null });

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return tree;
}

const N = 50;
const TRACKS = Array.from({ length: N }, (_, i) => TR(`k${i}`)); // stable identity for the whole run
const base = {
  visible: true as boolean,
  onClose: () => {},
  tracks: TRACKS,
  currentTrackId: 'k1' as string | null,
  isPlaying: true,
  quadrant: 'calm' as const,
  connection: 'connected' as 'connected' | 'connecting' | 'disconnected',
  onJump: () => {},
};

beforeEach(() => {
  jest.clearAllMocks();
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
});
afterEach(() => jest.restoreAllMocks());

describe('UpNextSheet — list re-render hygiene (L3/V2)', () => {
  it('a cursor-change re-render does not re-invoke every row — only the rows whose cursor state flips', async () => {
    const tree = await render(<UpNextSheet {...base} currentTrackId="k1" />);
    const initial = rowSpy.mock.calls.length;
    expect(initial).toBeGreaterThan(4); // a meaningful number of rows are live, so the bound below is not vacuous
    rowSpy.mockClear();

    // Move the live cursor k1 → k2 (both within the initial window). With memoized rows + stable
    // props, only those two rows may re-render; the other ~48 must be skipped.
    await ReactTestRenderer.act(async () => { tree.update(<UpNextSheet {...base} currentTrackId="k2" />); });
    const afterCursorMove = rowSpy.mock.calls.length;
    expect(afterCursorMove).toBeLessThan(initial);      // NOT every live row re-rendered
    expect(afterCursorMove).toBeLessThanOrEqual(4);     // bounded to the affected rows (k1 off, k2 on)
  });
});
