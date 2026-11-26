import React, { createRef } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AccessibilityInfo, I18nManager, PixelRatio, StyleSheet } from 'react-native';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS } from '../../../tokens/tokens.generated.ts';
import { EXTENSIONS } from '../../../tokens/tokens.extensions.generated.ts';
import { plateGeometry } from '../../Plate/geometry.ts';
import { plateSlot } from '../../Plate/readingOrder.ts';
import { PlateEntry, type PlateEntryHandle, type PlateEntryProps } from '../PlateEntry.tsx';

// Ruling 9 (the designer's rulings of 2026-11-25): the plate's TalkBack node is a button that opens the list of every
// place, never an adjustable that steps over cells. PlateEntry is a View over the plate's D×D box: role button, its label
// and hint the page's resolved plate.a11y.label and plate.a11y.hint; its activate action opens the list through the
// page's required onOpenList (RA-39: a callback, nothing else); pointerEvents none, so touch goes to PlateTouch; keyboard
// focusable, reporting its focus; hidden while the consent slot shows. Swipe order inside the plate is the plate node,
// the four rim words, then the latest bead (it sits in the plate's entry slot, readingOrder.ts; plateReadingOrder.test.tsx
// holds the order as Android sorts it); when Remove leaves no tap, focus comes back here (focus()).

const PLATE = plateGeometry({ base: BASE, direction: DIRECTIONS.abyss }, 296, 1);

function props(extra: Partial<PlateEntryProps> = {}): PlateEntryProps {
  return { plate: PLATE, label: 'plate.a11y.label', hint: 'plate.a11y.hint', onOpenList: jest.fn(), onFocusChange: jest.fn(), inert: false, ...extra };
}
function mount(extra: Partial<PlateEntryProps> = {}, ref = createRef<PlateEntryHandle>()) {
  const p = props(extra);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <DirectionProvider direction="abyss" face="dark">
        <PlateEntry {...p} ref={ref} />
      </DirectionProvider>,
    );
  });
  const node = () => tree.root.findAll((n) => n.props.testID === 'hero.listEntry' && typeof n.type === 'string')[0];
  const update = (next: Partial<PlateEntryProps>) => act(() => tree.update(<DirectionProvider direction="abyss" face="dark"><PlateEntry {...p} {...next} ref={ref} /></DirectionProvider>));
  return { tree, node, props: p, ref, update };
}
const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, any>;
const activate = (n: ReactTestRenderer.ReactTestInstance) => act(() => n.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }));

// The preset already installs sendAccessibilityEvent as a jest.fn, and jest.spyOn on an existing mock installs nothing
// and registers no restore (QA-112): its own implementation is captured and put back by identity, its calls cleared.
const focusEvent = AccessibilityInfo.sendAccessibilityEvent as unknown as jest.Mock;
const PRESET_SEND = focusEvent.getMockImplementation();
beforeEach(() => {
  focusEvent.mockClear();
  focusEvent.mockImplementation(() => undefined);
});
afterEach(() => {
  focusEvent.mockImplementation(PRESET_SEND);
  focusEvent.mockClear();
});

describe('PlateEntry: the plate’s TalkBack node (ruling 9)', () => {
  it('is a View over the plate’s D×D box, at its origin, that paints nothing and holds no string of its own', () => {
    const { node, tree } = mount();
    // Its box is the plate's, from the entry slot's origin: at the plate's origin in plate-local dp.
    const slot = plateSlot({ base: BASE, direction: DIRECTIONS.abyss }, PLATE, 'entry');
    const box = flat(node().props.style);
    expect(box).toEqual({ position: 'absolute', left: -slot.left, top: -slot.top, width: PLATE.diameter, height: PLATE.diameter });
    expect([slot.left + box.left, slot.top + box.top]).toEqual([0, 0]);
    expect(node().type).toBe('View');
    expect(tree.toJSON()).toMatchObject({ type: 'View', props: { testID: 'plate.slot.entry' }, children: [{ type: 'View', children: null }] });
  });

  it('sits in the plate’s entry slot (readingOrder.ts): never flattened, no touch, no accessibility element, the slot’s box', () => {
    const { tree } = mount();
    const slot = tree.root.findAll((n) => n.props.testID === 'plate.slot.entry' && typeof n.type === 'string')[0];
    expect(slot.props.collapsable).toBe(false);
    expect(slot.props.pointerEvents).toBe('none');
    expect(slot.props.accessible).toBeUndefined();
    expect(flat(slot.props.style)).toEqual({ position: 'absolute', ...plateSlot({ base: BASE, direction: DIRECTIONS.abyss }, PLATE, 'entry') });
  });

  it('its element ID is hero.listEntry, the ledger’s (F2)', () => {
    expect((EXTENSIONS.base.$root.hero.elements as readonly string[]).includes('hero.listEntry')).toBe(true);
    expect(mount().node().props.testID).toBe('hero.listEntry');
  });

  it('is a button, labelled and hinted from the page’s resolved copy, with an activate action', () => {
    const { node } = mount();
    expect(node().props).toMatchObject({ accessible: true, accessibilityRole: 'button', accessibilityLabel: 'plate.a11y.label', accessibilityHint: 'plate.a11y.hint' });
    expect(node().props.accessibilityActions).toEqual([{ name: 'activate' }]);
  });

  it('its activate action opens the list through onOpenList, once, and nothing else', () => {
    const { node, props: p } = mount();
    activate(node());
    expect(p.onOpenList).toHaveBeenCalledTimes(1);
    act(() => node().props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(p.onOpenList).toHaveBeenCalledTimes(1);
  });

  it('is never a touch target: touch goes through it to PlateTouch', () => {
    const { node } = mount();
    expect(node().props.pointerEvents).toBe('none');
    expect(node().props.onStartShouldSetResponder).toBeUndefined();
    expect(node().props.onPress).toBeUndefined();
  });

  it('is keyboard-focusable and reports its focus and its blur', () => {
    const { node, props: p } = mount();
    expect(node().props.focusable).toBe(true);
    act(() => node().props.onFocus({ nativeEvent: {} }));
    act(() => node().props.onBlur({ nativeEvent: {} }));
    expect((p.onFocusChange as jest.Mock).mock.calls).toEqual([[true], [false]]);
  });

  it('focus() moves the screen reader’s focus to it (the plate node, when Remove leaves no tap)', () => {
    const { ref, tree } = mount();
    act(() => ref.current!.focus());
    expect(focusEvent).toHaveBeenCalledTimes(1);
    // The jest preset's View is a component whose instance the ref holds (on a device, the host view): the node's own.
    const own = tree.root.findAll((n) => n.props.testID === 'hero.listEntry' && typeof n.type !== 'string')[0].instance;
    expect(own).toBeTruthy();
    expect(focusEvent.mock.calls[0][0] === own).toBe(true);
    expect(focusEvent.mock.calls[0][1]).toBe('focus');
  });

  it('hidden while inert (the consent slot shows, DEC-066): out of the accessibility tree, not focusable, no action, no focus', () => {
    const { node, props: p, ref } = mount({ inert: true });
    expect(node().props).toMatchObject({ accessible: false, focusable: false, importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true });
    expect(node().props.accessibilityActions).toEqual([]);
    activate(node());
    act(() => ref.current!.focus());
    expect(p.onOpenList).not.toHaveBeenCalled();
    expect(focusEvent).not.toHaveBeenCalled();
  });

  it('wakes when the slot goes: the same node is a button again', () => {
    const { node, props: p, update } = mount({ inert: true });
    update({ inert: false });
    expect(node().props).toMatchObject({ accessible: true, focusable: true, importantForAccessibility: 'yes', accessibilityElementsHidden: false });
    activate(node());
    expect(p.onOpenList).toHaveBeenCalledTimes(1);
  });

  it('is the same under RTL and at font scale 2.0: its box is the plate’s, physical, and it holds no text', () => {
    const plain = JSON.stringify(mount().tree.toJSON());
    const rtl = jest.replaceProperty(I18nManager, 'isRTL', true);
    const flipped = JSON.stringify(mount().tree.toJSON());
    rtl.restore();
    const spy = jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    const large = JSON.stringify(mount().tree.toJSON());
    spy.mockRestore();
    expect([flipped, large]).toEqual([plain, plain]);
  });
});
