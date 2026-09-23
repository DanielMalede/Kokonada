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

// Every tree this suite mounts is tracked so afterEach can unmount it. A sheet left mounted keeps its
// FlatList alive, and VirtualizedList drives its cell-render pass through a Batchinator whose
// updateCellsBatchingPeriod (50 ms) outlives the 20 ms settle below. That timer then fires AFTER this
// file is done, setState-s into the console jest has already frozen, and jest-runner answers by setting
// `process.exitCode = 1` - a run where every test passes and jest still exits 1. Unmounting disposes the
// batchinator, so the timer never survives the file.
const liveTrees = new Set<ReactTestRenderer.ReactTestRenderer>();

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  liveTrees.add(tree);
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
  // The cleanup invariant, checked where a violation is still attributable: if the PREVIOUS test left a
  // sheet mounted, its batch timer is already queued and this file is one scheduling accident away from
  // exiting 1 with everything green.
  expect(liveTrees.size).toBe(0);
  jest.clearAllMocks();
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
});
afterEach(async () => {
  // Unmount BEFORE restoring mocks: componentWillUnmount is what disposes VirtualizedList's batchinator,
  // and it still needs the mocked row/haptics modules to tear down through.
  for (const tree of liveTrees) {
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  }
  liveTrees.clear();
  jest.restoreAllMocks();
});

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

  it('unmounting disposes the cell-batching timer - nothing setState-s after the sheet is gone', async () => {
    const tree = await render(<UpNextSheet {...base} />);
    expect(rowSpy.mock.calls.length).toBeGreaterThan(4); // rows really mounted, so the wait below has something to catch

    const warnings: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { warnings.push(String(args[0])); });
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    liveTrees.delete(tree);
    // Well past updateCellsBatchingPeriod (50 ms): a batch timer that survived unmount would fire here and
    // React would warn about an update outside act(...) - the exact warning that turns into exit code 1.
    await new Promise((r) => setTimeout(r, 120));
    spy.mockRestore();
    expect(warnings.filter((w) => /not wrapped in act/.test(w))).toEqual([]);
  });
});
