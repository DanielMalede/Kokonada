// QA-047: the fake clock for loading, slow, timeout, error and stale tests.
//
// It is jest's modern fake timers with a documented split that matches a device: the wall clock
// (Date.now) can jump either way, as when the user changes the time or NTP corrects it, while the
// monotonic clock (performance.now) and the pending timers do not move with it. Verified in this repo:
// after jest.setSystemTime(now - 1 h), performance.now is unchanged and a 500 ms timeout still fires
// at 500 ms (pinned in __tests__/api.test.tsx). restore() returns to real timers and the preset's performance.now.

import { Text } from 'react-native';

export interface FakeClock {
  /** The wall clock (Date.now). */
  now(): number;
  /** Move both clocks forward, firing due timers. */
  advance(ms: number): void;
  /** As advance(), flushing promise callbacks between timers (for async code under test). */
  advanceAsync(ms: number): Promise<void>;
  /** Jump the wall clock by ms (negative = back). The monotonic clock and pending timers stay. */
  jumpWall(ms: number): void;
  restore(): void;
}

export function installFakeClock(options: { now?: number } = {}): FakeClock {
  jest.useFakeTimers(options.now != null ? { now: options.now } : {});
  return {
    now: () => Date.now(),
    advance: (ms) => { jest.advanceTimersByTime(ms); },
    advanceAsync: async (ms) => { await jest.advanceTimersByTimeAsync(ms); },
    jumpWall: (ms) => { jest.setSystemTime(Date.now() + ms); },
    restore: () => { jest.useRealTimers(); },
  };
}

// An age is a number and a unit. The number may be what a broken formatter prints: a sign (ASCII
// hyphen-minus or U+2212, as Intl prints), NaN or Infinity. A sign counts only where it cannot be a
// hyphen or a range ("Top-5 mins ago", "5-10 min ago" are honest copy), so it must not follow a word
// character.
const UNIT = /(?:s|sec|secs|seconds?|m|min|mins|minutes?|h|hrs?|hours?|d|days?)/.source;
const NUMBER = /(?:\d+(?:[.,]\d+)?|NaN|Infinity)/.source;
const SIGN = /(?<![\w.])[-−]\s*/.source;
const NEGATIVE_AGO = new RegExp(`${SIGN}${NUMBER}\\s*${UNIT}\\s+ago\\b`, 'i');
const BROKEN_AGO = new RegExp(`(?<![\\w.])(?:NaN|Infinity)\\s*${UNIT}\\s+ago\\b`, 'i');
// "in 55 minutes" states a future age; "Check-in 5m ago" is not one.
const FUTURE_AGE = new RegExp(`(?<![\\w-])in\\s+(?:${SIGN})?${NUMBER}\\s*${UNIT}\\b(?!\\s+ago)`, 'i');

/**
 * The displayed strings that state a negative age ("-55m ago", "−55m ago"), an age that is not a
 * number ("NaNm ago", "Infinityh ago") or a future one ("in 55 minutes"). Read the strings with
 * renderedTexts(), so an interpolated age ({age}m ago) is seen as the user sees it.
 */
export function negativeAges(texts: string[]): string[] {
  return texts.filter((t) => NEGATIVE_AGO.test(t) || BROKEN_AGO.test(t) || FUTURE_AGE.test(t));
}

interface RenderedNode { props: { children?: unknown } }
interface RenderedTree { root: { findAllByType(type: unknown): RenderedNode[] } }

/**
 * The text of every <Text> in a rendered tree, as it reads on screen: a Text's string and number
 * children joined with no separator ({age}m ago renders "-55m ago", where String(children) gives
 * "-55,m ago"). A nested <Text> contributes its own entry.
 */
export function renderedTexts(tree: RenderedTree): string[] {
  const flat = (c: unknown): string => {
    if (Array.isArray(c)) return c.map(flat).join('');
    return typeof c === 'string' || typeof c === 'number' ? String(c) : '';
  };
  return tree.root.findAllByType(Text).map((n) => flat(n.props.children));
}
