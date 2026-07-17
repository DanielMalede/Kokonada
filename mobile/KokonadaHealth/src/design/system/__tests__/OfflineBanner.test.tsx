import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Animated, AccessibilityInfo } from 'react-native';

// Deterministic theme/motion so the timing state machine is the only variable under test.
jest.mock('../../theme', () => ({ useTheme: jest.fn(), useMotion: jest.fn() }));

import { OfflineBanner, OFFLINE_GRACE_MS, BACK_ONLINE_HOLD_MS } from '../OfflineBanner';
import { useTheme, useMotion } from '../../theme';
import { colors, motion } from '../../tokens';

const DARK = colors.dark;

jest.useFakeTimers();

beforeEach(() => {
  jest.clearAllTimers();
  jest.clearAllMocks();
  (useTheme as jest.Mock).mockReturnValue({ name: 'dark', c: DARK });
  (useMotion as jest.Mock).mockReturnValue({ reduced: false, duration: motion.duration });
});
afterAll(() => { jest.useRealTimers(); });

function flatStyle(node: any): Record<string, unknown> {
  const s = node?.props?.style;
  return Array.isArray(s) ? Object.assign({}, ...s.flat(Infinity).filter(Boolean)) : (s ?? {});
}
const textOf = (node: any, acc: string[] = []): string[] => {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => textOf(n, acc)); return acc; }
  if (node.children) textOf(node.children, acc);
  return acc;
};
const banner = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => n.props?.testID === 'offline-banner' && typeof n.type === 'string')[0];
const dot = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => n.props?.testID === 'offline-dot' && typeof n.type === 'string')[0];
const copy = (tree: ReactTestRenderer.ReactTestRenderer) => textOf(tree.toJSON()).join(' ');
const readOpacity = (v: unknown): unknown => (typeof v === 'number' ? v : v && typeof (v as any).__getValue === 'function' ? (v as any).__getValue() : v);

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  return tree;
}
async function setStatus(tree: ReactTestRenderer.ReactTestRenderer, status: 'disconnected' | 'connecting' | 'connected', onRetry?: () => void) {
  await ReactTestRenderer.act(async () => { tree.update(<OfflineBanner status={status} onRetry={onRetry} />); });
}
async function advance(ms: number) {
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(ms); });
}

describe('OfflineBanner — the music never stops', () => {
  it('exposes the grace + hold constants (1400ms appear debounce, 1600ms back-online hold)', () => {
    expect(OFFLINE_GRACE_MS).toBe(1400);
    expect(BACK_ONLINE_HOLD_MS).toBe(1600);
  });

  it('steady connected → renders nothing (zero layout footprint)', async () => {
    const tree = await render(<OfflineBanner status="connected" />);
    expect(banner(tree)).toBeUndefined();
    await advance(5000);
    expect(banner(tree)).toBeUndefined();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('disconnected → suppressed until the grace window elapses, then shows the reassuring copy', async () => {
    const tree = await render(<OfflineBanner status="disconnected" />);
    expect(banner(tree)).toBeUndefined();          // still within grace — nothing yet
    await advance(OFFLINE_GRACE_MS - 1);
    expect(banner(tree)).toBeUndefined();
    await advance(1);                               // grace elapsed
    expect(banner(tree)).toBeTruthy();
    expect(copy(tree).toLowerCase()).toContain('saved moments'); // "playing from your saved moments"
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('a transient blip (disconnect → reconnect inside the grace window) never appears', async () => {
    const tree = await render(<OfflineBanner status="disconnected" />);
    await advance(OFFLINE_GRACE_MS - 200); // still hidden
    await setStatus(tree, 'connected');    // recovered before grace fired
    await advance(2000);
    expect(banner(tree)).toBeUndefined();  // the blip was swallowed
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('connecting → after grace shows "Reconnecting…" with a breathing accent dot', async () => {
    const fake = { start: jest.fn(), stop: jest.fn(), reset: jest.fn() };
    const loopSpy = jest.spyOn(Animated, 'loop').mockReturnValue(fake as any);
    const tree = await render(<OfflineBanner status="connecting" />);
    await advance(OFFLINE_GRACE_MS);
    expect(copy(tree).toLowerCase()).toContain('reconnect');
    expect(flatStyle(dot(tree)).backgroundColor).toBe(DARK.accent.glow);
    expect(loopSpy).toHaveBeenCalled(); // the dot breathes while connecting
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    loopSpy.mockRestore();
  });

  it('recovery → shows "Back online" immediately (no grace), then recedes after the hold', async () => {
    const tree = await render(<OfflineBanner status="disconnected" />);
    await advance(OFFLINE_GRACE_MS);
    expect(banner(tree)).toBeTruthy();
    await setStatus(tree, 'connected');
    expect(copy(tree).toLowerCase()).toContain('back online'); // instant, no grace on recovery
    expect(flatStyle(dot(tree)).backgroundColor).toBe(DARK.accent.glow); // confirm dot ≥3:1 in both themes
    await advance(BACK_ONLINE_HOLD_MS - 1);
    expect(banner(tree)).toBeTruthy();       // still holding "Back online"
    await advance(1);
    expect(banner(tree)).toBeUndefined();    // receded — the banner tidies itself away
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('disconnected dot is a static content.tertiary supportive dot (no breath loop)', async () => {
    const loopSpy = jest.spyOn(Animated, 'loop');
    const tree = await render(<OfflineBanner status="disconnected" />);
    await advance(OFFLINE_GRACE_MS);
    expect(flatStyle(dot(tree)).backgroundColor).toBe(DARK.content.tertiary);
    expect(loopSpy).not.toHaveBeenCalled(); // static — no pulse while offline
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    loopSpy.mockRestore();
  });

  it('is NON-ALARM: no danger/red hue and never role="alert"/"assertive" — message rides on content.primary', async () => {
    const tree = await render(<OfflineBanner status="disconnected" />);
    await advance(OFFLINE_GRACE_MS);
    const colorsUsed = new Set<string>();
    for (const n of tree.root.findAll(() => true)) {
      const st = flatStyle(n) as any;
      for (const k of ['backgroundColor', 'borderColor', 'color']) if (typeof st[k] === 'string') colorsUsed.add(st[k]);
    }
    expect(colorsUsed.has(DARK.state.danger)).toBe(false);
    expect(colorsUsed.has(colors.light.state.danger)).toBe(false);
    expect(tree.root.findAll((n) => n.props?.accessibilityRole === 'alert')).toHaveLength(0);
    expect(banner(tree).props.accessibilityLiveRegion).toBe('polite'); // polite, never assertive
    const message = tree.root.findAll((n) => n.type === 'Text' && textOf(n).join('').toLowerCase().includes('offline'))[0];
    expect(flatStyle(message).color).toBe(DARK.content.primary);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('announces politely on transition only — "Offline…" on appear, "Back online" on recovery', async () => {
    const tree = await render(<OfflineBanner status="disconnected" />);
    await advance(OFFLINE_GRACE_MS);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    expect((AccessibilityInfo.announceForAccessibility as jest.Mock).mock.calls[0][0].toLowerCase()).toContain('offline');
    await setStatus(tree, 'connected');
    expect((AccessibilityInfo.announceForAccessibility as jest.Mock).mock.calls[1][0].toLowerCase()).toContain('back online');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('DISPLAY-ONLY: onRetry is the only outbound call; pressing Retry invokes it', async () => {
    const onRetry = jest.fn();
    const tree = await render(<OfflineBanner status="disconnected" onRetry={onRetry} />);
    await advance(OFFLINE_GRACE_MS);
    const retry = tree.root.findAll((n) => n.props?.testID === 'offline-retry' && n.parent?.props?.testID !== 'offline-retry')[0];
    expect(retry).toBeTruthy();
    await ReactTestRenderer.act(async () => { retry.props.onPress(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('reduced motion: appears instantly (opacity 1), dot never breathes, same end copy', async () => {
    (useMotion as jest.Mock).mockReturnValue({ reduced: true, duration: motion.durationReduced });
    const loopSpy = jest.spyOn(Animated, 'loop');
    const tree = await render(<OfflineBanner status="connecting" />);
    await advance(OFFLINE_GRACE_MS);
    expect(readOpacity(flatStyle(banner(tree)).opacity)).toBe(1); // no fade — snapped in
    expect(loopSpy).not.toHaveBeenCalled();                       // dot still, no breath
    expect(copy(tree).toLowerCase()).toContain('reconnect');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    loopSpy.mockRestore();
  });
});
