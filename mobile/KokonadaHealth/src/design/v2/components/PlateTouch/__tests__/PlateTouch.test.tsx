import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { I18nManager, PixelRatio, StyleSheet } from 'react-native';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS } from '../../../tokens/tokens.generated.ts';
import { plateGeometry, pointToLocal, wheelLayout, type PlatePoint } from '../../Plate/geometry.ts';
import type { PlateEntryHandle } from '../PlateEntry.tsx';
import { PlateTouch, type PlateTouchProps } from '../PlateTouch.tsx';
import { HAPTIC_GAP, touchSurface } from '../plateTouchModel.ts';

// PlateTouch, the plate's gesture surface (F10 group A). It owns every input the plate takes: a tap or a drag
// to place, a tap on the latest bead to remove it, and the latest bead's TalkBack Remove action (the plate's own TalkBack
// node is PlateEntry, the list's button: ruling 9). It
// takes callbacks only (RA-39): a placement is handed to onPlace and nothing else, so P10's taps stay in page
// state and P2's go through its port. The touch-to-point mapping is the page's screenToCircumplex, passed in
// (QA-087: v2 never reimplements it), and handed the plate's wheelLayout (DSN-025).
//
// The gesture tests drive the surface's own responder handlers in the order React Native's responder system
// calls them (grant, start, move, release; or terminate when a scroll view takes the touch over). That is the
// handler code the device runs; the native negotiation itself is device evidence (G11).

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const TOKENS = { base: BASE, direction: DIRECTIONS.abyss };
const PLATE = plateGeometry(TOKENS, 296, 1);
const SURFACE = touchSurface(TOKENS, PLATE);
const M = SURFACE.margin;
const R = PLATE.radius;
const MAPPED: PlatePoint = { x: 0.123, y: -0.456 };

interface Calls {
  readonly toPoint: jest.Mock;
  readonly onPlace: jest.Mock;
  readonly onRemoveLatest: jest.Mock;
  readonly fire: jest.Mock;
}
/** The page's PlateEntry, as PlateTouch sees it through its ref: focus() is what it may call. */
type Entry = { focus: jest.Mock };
function props(taps: PlateTouchProps['taps'], calls: Calls, entry: Entry, extra: Partial<PlateTouchProps> = {}): PlateTouchProps {
  return {
    plate: PLATE,
    taps,
    toPoint: calls.toPoint,
    onPlace: calls.onPlace,
    onRemoveLatest: calls.onRemoveLatest,
    haptics: { fire: calls.fire },
    inert: false,
    entry: { current: entry as PlateEntryHandle },
    latestLabel: 'bead.latest.label',
    removeLabel: 'bead.latest.remove',
    ...extra,
  };
}
const element = (p: PlateTouchProps) => (
  <DirectionProvider direction="abyss" face="dark">
    <PlateTouch {...p} />
  </DirectionProvider>
);
function mount(taps: readonly PlatePoint[] = [], extra: Partial<PlateTouchProps> = {}) {
  const calls: Calls = { toPoint: jest.fn(() => MAPPED), onPlace: jest.fn(), onRemoveLatest: jest.fn(), fire: jest.fn() };
  const entry: Entry = { focus: jest.fn() };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(element(props(taps, calls, entry, extra)));
  });
  const update = (nextTaps: readonly PlatePoint[], next: Partial<PlateTouchProps> = {}) => act(() => tree.update(element(props(nextTaps, calls, entry, { ...extra, ...next }))));
  return { tree, calls, entry, update };
}
const node = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) => tree.root.findAll((n) => n.props.testID === testID && typeof n.type === 'string')[0];
/** The rendered tree as data: every host node and prop, the handlers (fresh closures each mount) left out. */
const drawn = (tree: ReactTestRenderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());
const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, any>;

/** A responder event at a spot in the surface's own dp. */
const evt = (x: number, y: number, touches = 1) => ({
  nativeEvent: { locationX: x, locationY: y, pageX: x, pageY: y, touches: Array.from({ length: touches }, (_, i) => ({ identifier: i })), changedTouches: [{ identifier: 0 }], identifier: 0, timestamp: 0 },
});
/** The surface's spot for a spot in the plate box. */
const s = (p: { x: number; y: number }) => ({ x: p.x + M, y: p.y + M });
/** A touch, as the responder system delivers one: granted, started, moved, released. */
function touch(tree: ReactTestRenderer.ReactTestRenderer, from: { x: number; y: number }, to = from) {
  const surface = node(tree, 'plate.touch');
  let granted = false;
  act(() => {
    granted = surface.props.onStartShouldSetResponder(evt(from.x, from.y));
    if (!granted) return;
    surface.props.onResponderGrant(evt(from.x, from.y));
    surface.props.onResponderStart(evt(from.x, from.y));
    surface.props.onResponderMove(evt(to.x, to.y));
    surface.props.onResponderRelease(evt(to.x, to.y, 0));
  });
  return granted;
}
const a11y = (tree: ReactTestRenderer.ReactTestRenderer, testID: string, actionName: string) =>
  act(() => node(tree, testID).props.onAccessibilityAction({ nativeEvent: { actionName } }));

describe('PlateTouch: the surface', () => {
  it('is the plate grown by the margin, centred on the plate box, LTR, and paints nothing', () => {
    const { tree } = mount();
    const style = flat(node(tree, 'plate.touch').props.style);
    expect(style).toMatchObject({ position: 'absolute', left: -M, top: -M, width: SURFACE.size, height: SURFACE.size, direction: 'ltr' });
    for (const n of tree.root.findAll((x) => typeof x.type === 'string')) {
      const st = flat(n.props.style);
      for (const key of ['backgroundColor', 'borderColor', 'borderWidth', 'color', 'boxShadow', 'elevation']) expect(st[key]).toBeUndefined();
    }
  });

  it('lets a scroll view take a touch over (a vertical drag scrolls, LEDGER §6)', () => {
    const { tree } = mount();
    expect(node(tree, 'plate.touch').props.onResponderTerminationRequest()).toBe(true);
  });
});

describe('PlateTouch: tap and drag to place', () => {
  it('a tap maps its spot through the page’s screenToCircumplex, with the plate’s wheelLayout, and hands onPlace exactly that point', () => {
    const { tree, calls } = mount();
    const spot = { x: R + 50, y: R - 30 };
    touch(tree, s(spot));
    expect(calls.toPoint).toHaveBeenCalledTimes(1);
    expect(calls.toPoint).toHaveBeenCalledWith(spot, wheelLayout(PLATE));
    expect(calls.onPlace).toHaveBeenCalledTimes(1);
    expect(calls.onPlace.mock.calls[0][0]).toBe(MAPPED);
    expect(calls.onRemoveLatest).not.toHaveBeenCalled();
  });

  // QA-087's mapping is x = (px − cx)/r, y = −(py − cy)/r: so a touch on a bead's own spot maps back to that bead's
  // point exactly when PlateTouch hands over the plate-box spot and wheelLayout, which pointToLocal and the field share.
  it('a touch on any point’s drawn spot hands over that spot and the wheel that maps it back to the point', () => {
    const { tree, calls } = mount();
    for (const p of [{ x: 0.566, y: 0.566 }, { x: -0.3, y: -0.8 }, { x: 0, y: 0 }, { x: 1, y: 0 }]) {
      const spot = pointToLocal(p, PLATE);
      touch(tree, s(spot));
      const [given, layout] = calls.toPoint.mock.calls[calls.toPoint.mock.calls.length - 1];
      expect((given.x - layout.cx) / layout.radius).toBeCloseTo(p.x, 9);
      expect(-(given.y - layout.cy) / layout.radius).toBeCloseTo(p.y, 9);
    }
  });

  it('a drag places where it is released', () => {
    const { tree, calls } = mount();
    const end = { x: R - 60, y: R + 20 };
    touch(tree, s({ x: R, y: R }), s(end));
    expect(calls.toPoint).toHaveBeenCalledWith(end, wheelLayout(PLATE));
    expect(calls.onPlace).toHaveBeenCalledTimes(1);
  });

  it('a touch a scroll view takes over (terminated) places nothing and fires no haptic', () => {
    const { tree, calls } = mount();
    const surface = node(tree, 'plate.touch');
    act(() => {
      surface.props.onStartShouldSetResponder(evt(R, R));
      surface.props.onResponderGrant(evt(R, R));
      surface.props.onResponderStart(evt(R, R));
      surface.props.onResponderMove(evt(R, R + 30));
      surface.props.onResponderTerminate(evt(R, R + 30));
    });
    expect(calls.onPlace).not.toHaveBeenCalled();
    expect(calls.fire).not.toHaveBeenCalled();
    touch(tree, s({ x: R, y: R }));
    expect(calls.onPlace).toHaveBeenCalledTimes(1);
  });

  it('a second finger cancels the touch: a pinch places nothing', () => {
    const { tree, calls } = mount();
    const surface = node(tree, 'plate.touch');
    act(() => {
      surface.props.onStartShouldSetResponder(evt(R, R));
      surface.props.onResponderGrant(evt(R, R));
      surface.props.onResponderStart(evt(R, R));
      surface.props.onResponderStart(evt(R + 40, R, 2));
      surface.props.onResponderRelease(evt(R, R, 0));
    });
    expect(calls.onPlace).not.toHaveBeenCalled();
  });

  it('a touch in a corner of the surface, off the plate, places nothing', () => {
    const { tree, calls } = mount();
    touch(tree, { x: 1, y: 1 });
    expect(calls.onPlace).not.toHaveBeenCalled();
    expect(calls.fire).not.toHaveBeenCalled();
  });
});

describe('PlateTouch: the latest bead', () => {
  const latest = { x: 0.6, y: 0.6 };
  const older = { x: -0.6, y: -0.6 };

  it('a tap on the latest bead removes it, and nothing is placed', () => {
    const { tree, calls } = mount([older, latest]);
    touch(tree, s(pointToLocal(latest, PLATE)));
    expect(calls.onRemoveLatest).toHaveBeenCalledTimes(1);
    expect(calls.onPlace).not.toHaveBeenCalled();
    expect(calls.toPoint).not.toHaveBeenCalled();
  });

  it('only the latest is removable: a tap on an older bead places a new point there', () => {
    const { tree, calls } = mount([older, latest]);
    touch(tree, s(pointToLocal(older, PLATE)));
    expect(calls.onRemoveLatest).not.toHaveBeenCalled();
    expect(calls.onPlace).toHaveBeenCalledTimes(1);
  });

  it('its accessibility node is a 48 dp button on the bead: rendered bounds, not hitSlop (QA-028)', () => {
    const { tree } = mount([older, latest]);
    const n = node(tree, 'plate.touch.latest');
    const c = pointToLocal(latest, PLATE);
    expect(flat(n.props.style)).toMatchObject({ position: 'absolute', left: c.x - SURFACE.hit / 2 + M, top: c.y - SURFACE.hit / 2 + M, width: SURFACE.hit, height: SURFACE.hit });
    expect(SURFACE.hit).toBeGreaterThanOrEqual(BASE.target.min);
    expect(n.props.hitSlop).toBeUndefined();
    expect(n.props).toMatchObject({ accessible: true, accessibilityRole: 'button', accessibilityLabel: 'bead.latest.label', pointerEvents: 'none' });
    expect(n.props.accessibilityActions).toEqual([{ name: 'activate', label: 'bead.latest.remove' }]);
  });

  it('its Remove action removes the latest, with the remove haptic', () => {
    const { tree, calls } = mount([older, latest]);
    a11y(tree, 'plate.touch.latest', 'activate');
    expect(calls.onRemoveLatest).toHaveBeenCalledTimes(1);
    expect(calls.fire).toHaveBeenCalledWith('remove');
  });

  it('with no tap there is no latest node', () => {
    const { tree } = mount([]);
    expect(node(tree, 'plate.touch.latest')).toBeUndefined();
  });
});

describe('PlateTouch: haptics (L12, DSN-040): place, replace, remove, at least minEventGap apart', () => {
  it('place below three taps, replace at three, remove on the latest', () => {
    const one = mount([]);
    touch(one.tree, s({ x: R, y: R }));
    expect(one.calls.fire).toHaveBeenLastCalledWith('place');
    const full = mount([{ x: 0.6, y: 0.6 }, { x: 0.6, y: -0.6 }, { x: -0.6, y: -0.6 }]);
    touch(full.tree, s({ x: R, y: R }));
    expect(full.calls.fire).toHaveBeenLastCalledWith('replace');
    act(() => {
      jest.advanceTimersByTime(HAPTIC_GAP);
    });
    touch(full.tree, s(pointToLocal({ x: -0.6, y: -0.6 }, PLATE)));
    expect(full.calls.fire).toHaveBeenLastCalledWith('remove');
  });

  it('a second haptic inside the gap is dropped, while the placement itself still happens', () => {
    const { tree, calls } = mount([]);
    touch(tree, s({ x: R, y: R }));
    act(() => {
      jest.advanceTimersByTime(HAPTIC_GAP - 1);
    });
    touch(tree, s({ x: R + 10, y: R }));
    expect(calls.onPlace).toHaveBeenCalledTimes(2);
    expect(calls.fire).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    touch(tree, s({ x: R + 20, y: R }));
    expect(calls.fire).toHaveBeenCalledTimes(2);
  });
});

describe('PlateTouch: inert while the consent slot shows (DEC-066)', () => {
  it('takes no touch, places nothing, removes nothing, fires no haptic, and leaves the accessibility tree', () => {
    const { tree, calls } = mount([{ x: 0.6, y: 0.6 }], { inert: true });
    expect(touch(tree, s({ x: R, y: R }))).toBe(false);
    const surface = node(tree, 'plate.touch');
    act(() => {
      surface.props.onResponderGrant(evt(R, R));
      surface.props.onResponderRelease(evt(R, R, 0));
    });
    a11y(tree, 'plate.touch.latest', 'activate');
    expect(calls.onPlace).not.toHaveBeenCalled();
    expect(calls.onRemoveLatest).not.toHaveBeenCalled();
    expect(calls.fire).not.toHaveBeenCalled();
    expect(surface.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(surface.props.accessibilityElementsHidden).toBe(true);
  });

  it('wakes when the slot goes: the same surface places again', () => {
    const { tree, calls, update } = mount([], { inert: true });
    update([], { inert: false });
    touch(tree, s({ x: R, y: R }));
    expect(calls.onPlace).toHaveBeenCalledTimes(1);
  });
});

describe('PlateTouch: TalkBack (ruling 9: the plate node is PlateEntry, the list’s button)', () => {
  const latest = { x: 0.6, y: 0.6 };
  const older = { x: -0.6, y: -0.6 };
  const exposed = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAll((n) => typeof n.type === 'string' && n.props.accessible === true).map((n) => n.props.testID);

  it('exposes only the latest bead’s node, never an adjustable: the plate node is PlateEntry’s, before the rim words', () => {
    expect(exposed(mount([older, latest]).tree)).toEqual(['plate.touch.latest']);
    expect(exposed(mount([]).tree)).toEqual([]);
    const { tree } = mount([latest]);
    expect(tree.root.findAll((n) => n.props.accessibilityRole === 'adjustable').map((n) => n.props.testID)).toEqual([]);
    expect(node(tree, 'plate.touch').props.accessible).toBe(false);
  });

  it('when Remove leaves no tap, focus moves to the plate node first, then the latest is removed', () => {
    const { tree, calls, entry } = mount([latest]);
    const order: string[] = [];
    entry.focus.mockImplementation(() => order.push('focus'));
    calls.onRemoveLatest.mockImplementation(() => order.push('remove'));
    a11y(tree, 'plate.touch.latest', 'activate');
    expect(order).toEqual(['focus', 'remove']);
  });

  it('when Remove leaves a tap, focus stays where TalkBack puts it (the next latest bead’s node)', () => {
    const { tree, calls, entry } = mount([older, latest]);
    a11y(tree, 'plate.touch.latest', 'activate');
    expect(calls.onRemoveLatest).toHaveBeenCalledTimes(1);
    expect(entry.focus).not.toHaveBeenCalled();
  });

  it('a touch on the latest bead removes it with no focus move: the sighted path is not the screen reader’s', () => {
    const { tree, calls, entry } = mount([latest]);
    touch(tree, s(pointToLocal(latest, PLATE)));
    expect(calls.onRemoveLatest).toHaveBeenCalledTimes(1);
    expect(entry.focus).not.toHaveBeenCalled();
  });

  it('while inert, Remove neither removes nor moves focus', () => {
    const { tree, calls, entry } = mount([latest], { inert: true });
    a11y(tree, 'plate.touch.latest', 'activate');
    expect(calls.onRemoveLatest).not.toHaveBeenCalled();
    expect(entry.focus).not.toHaveBeenCalled();
  });
});

describe('PlateTouch: RTL, font scale and motion', () => {
  // QA-088's jest half: under RTL the plate root stays LTR and every quadrant and the centre map as under LTR.
  it('under RTL the same touches hand over the same spots and the same wheel, and the tree is the same', () => {
    const spots = [{ x: 0.566, y: 0.566 }, { x: 0.566, y: -0.566 }, { x: -0.566, y: -0.566 }, { x: -0.566, y: 0.566 }, { x: 0, y: 0 }].map((p) => s(pointToLocal(p, PLATE)));
    const run = () => {
      const { tree, calls } = mount([{ x: 0.2, y: 0.3 }]);
      for (const spot of spots) {
        act(() => {
          jest.advanceTimersByTime(HAPTIC_GAP);
        });
        touch(tree, spot);
      }
      return { json: drawn(tree), calls: calls.toPoint.mock.calls };
    };
    const ltr = run();
    const rtl = jest.replaceProperty(I18nManager, 'isRTL', true);
    const flipped = run();
    rtl.restore();
    expect(flipped.calls).toStrictEqual(ltr.calls);
    expect(flipped.json).toEqual(ltr.json);
  });

  it('at font scale 2.0 the surface and its targets are unchanged (it holds no text)', () => {
    const plain = drawn(mount([{ x: 0.6, y: 0.6 }]).tree);
    const spy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    const large = drawn(mount([{ x: 0.6, y: 0.6 }]).tree);
    spy.mockRestore();
    expect(large).toEqual(plain);
  });

  it('has no motion of its own: a placement starts no timer and no frame', () => {
    const { tree } = mount([]);
    jest.clearAllTimers();
    touch(tree, s({ x: R, y: R }));
    expect(jest.getTimerCount()).toBe(0);
  });
});
