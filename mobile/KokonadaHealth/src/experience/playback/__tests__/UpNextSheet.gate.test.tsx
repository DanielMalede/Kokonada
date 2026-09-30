import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AccessibilityInfo, BackHandler } from 'react-native';

// DEC-099 (owner ruling; HX-4 M4): with the SHIPPED gate the Up Next sheet is unreachable by ANY
// path — whoever mounts it, with whatever props, it renders nothing and registers nothing. Its rows
// show track metadata with no per-row link-back (CMP-008), which is why it stays off until P3. The
// sheet's own behaviour for P3 is pinned in UpNextSheet.test.tsx with the gate forced on; nothing
// here mocks the gate.

jest.mock('../../player/SpotifyAttribution', () => {
  const React2 = require('react');
  const { View } = require('react-native');
  return { SpotifyAttribution: () => React2.createElement(View, { testID: 'spotify-attribution' }) };
});
jest.mock('../../../design/haptics', () => ({ fireHaptic: jest.fn() }));

import { UpNextSheet } from '../UpNextSheet';
import type { QueueTrack } from '../playbackQueue';

const TR = (id: string): QueueTrack => ({ id, uri: `spotify:track:${id}`, title: `Title ${id}`, artist: `Artist ${id}`, receipt: null, recordingKey: null });

const props = {
  visible: true,
  onClose: () => {},
  tracks: [TR('a'), TR('b')],
  currentTrackId: 'a',
  isPlaying: true,
  quadrant: 'calm' as const,
  connection: 'connected' as const,
  onJump: () => {},
};

const trees: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(async () => {
  for (const t of trees.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
  jest.restoreAllMocks();
});

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  trees.push(tree);
  return tree;
}

beforeEach(() => {
  (AccessibilityInfo.isReduceMotionEnabled as jest.Mock) = jest.fn().mockResolvedValue(false);
});

describe('UpNextSheet — unreachable by any path until P3 (DEC-099)', () => {
  it('renders nothing even when mounted and asked to be visible', async () => {
    const tree = await render(<UpNextSheet {...props} />);
    expect(tree.toJSON()).toBeNull();
    expect(tree.root.findAll((n) => n.props.testID === 'upnext-sheet')).toHaveLength(0);
  });

  it('stays empty through a visible → hidden → visible cycle', async () => {
    const tree = await render(<UpNextSheet {...props} visible={false} />);
    await ReactTestRenderer.act(async () => { tree.update(<UpNextSheet {...props} visible />); });
    await ReactTestRenderer.act(async () => { tree.update(<UpNextSheet {...props} visible={false} />); });
    await ReactTestRenderer.act(async () => { tree.update(<UpNextSheet {...props} visible />); });
    expect(tree.toJSON()).toBeNull();
  });

  it('registers no hardware-Back handler (there is nothing to dismiss)', async () => {
    const add = jest.spyOn(BackHandler, 'addEventListener');
    await render(<UpNextSheet {...props} />);
    expect(add).not.toHaveBeenCalled();
  });

  it('the shipped gate is off — re-enabling needs per-row link-backs first (CMP-008)', () => {
    expect(jest.requireActual('../upNextGate').UP_NEXT_ENABLED).toBe(false);
  });
});
