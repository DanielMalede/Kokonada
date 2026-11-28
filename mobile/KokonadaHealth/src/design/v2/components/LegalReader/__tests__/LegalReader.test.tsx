import React from 'react';
import { AccessibilityInfo, I18nManager, StyleSheet, Text, View } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { fontFace } from '../../../typeface/faces.ts';
import { LRI, PDI, type LegalDocument } from '../legalDocument.ts';
import { LegalReader, type LegalReaderProps } from '../LegalReader.tsx';
import { readerSpace } from '../readerSpace.ts';

// The F10 LegalReader (P1 spec §B; DEC-194 items 88, 89 and 97): the bundled privacy policy or terms, injected by the
// caller, shown without leaving the app. A modal's content: the TopBar with the document's title and Close, the meta
// block whose top line is the current-text line with the hosted address (a prop), then the version, then the body.
// Selectable text, nothing pressable inside the document, Heebo only (CMP-122), no request and no Linking.

// A stateful fake of the part of Reanimated the reader uses, as the Well's suite has it: a shared value lives for the
// mount, an animated style reads it live, and withTiming records each animation and lands on its target.
jest.mock('react-native-reanimated', () => {
  const { useRef } = require('react');
  const RNView = require('react-native').View;
  const timings: Array<{ toValue: number; config: { duration: number } }> = [];
  return {
    __esModule: true,
    default: { View: RNView },
    View: RNView,
    useSharedValue: (initial: number) => {
      const ref = useRef(null as null | { value: number });
      if (ref.current === null) ref.current = { value: initial };
      return ref.current;
    },
    useAnimatedStyle: (updater: () => Record<string, unknown>) => {
      const live = {};
      for (const key of Object.keys(updater())) Object.defineProperty(live, key, { enumerable: true, get: () => updater()[key] });
      return live;
    },
    withTiming: (toValue: number, config: { duration: number }) => {
      timings.push({ toValue, config });
      return toValue;
    },
    Easing: { bezier: () => (t: number) => t },
    __timings: timings,
  };
});
const timings = (): Array<{ toValue: number; config: { duration: number } }> => jest.requireMock('react-native-reanimated').__timings;

type Node = ReactTestRenderer.ReactTestInstance;
const flat = (n: Node) => StyleSheet.flatten(n.props.style) ?? {};
const isHost = (n: Node) => typeof n.type === 'string';
const T = DIRECTIONS.abyss;
const SPACE = readerSpace({ base: BASE, direction: T });
/** Safe-area insets a route might pass: a status bar and a gesture bar, as numbers on the spacing scale. */
const TOP_INSET = BASE.spacing['7'];
const BOTTOM_INSET = BASE.spacing['8'];

const DOC: LegalDocument = {
  title: 'Privacy policy (sample)',
  version: '3',
  dateLabel: '1 March 2026',
  blocks: [
    { kind: 'heading', text: 'Who we are' },
    { kind: 'paragraph', text: 'Write to privacy@example.org or read https://example.org/privacy.' },
    { kind: 'list', items: ['First', 'Second'] },
    { kind: 'heading', text: 'Your choices' },
    { kind: 'list', ordered: true, items: ['One', 'Two', 'Three'] },
    { kind: 'paragraph', text: 'The end.' },
  ],
};
const ADDRESS = 'https://example.org/privacy';
const LINES: LegalReaderProps['lines'] = {
  current: (address) => `The current text is online at ${address}.`,
  version: (version, date) => `Version ${version}, ${date}.`,
};

type Mounted = Partial<LegalReaderProps> & { face?: Face };
function mount(over: Mounted = {}) {
  const { face = 'dark', ...rest } = over;
  const props: LegalReaderProps = { document: DOC, script: 'latin', address: ADDRESS, lines: LINES, closeLabel: 'Close', onClose: jest.fn(), tier: 'full', ...rest };
  const tree = (p: LegalReaderProps) => (
    <DirectionProvider direction="abyss" face={face}>
      <LegalReader {...p} />
    </DirectionProvider>
  );
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    // A host ref is an object, as on the device, so the reader can move TalkBack focus to its title.
    r = ReactTestRenderer.create(tree(props), { createNodeMock: () => ({}) });
  });
  const byId = (id: string) => r.root.find((n) => isHost(n) && n.props.testID === id);
  const all = (pred: (n: Node) => boolean) => r.root.findAll((n) => isHost(n) && pred(n));
  const texts = () => all((n) => String(n.type) === 'Text');
  const body = () => byId('legalReader.body');
  const scroll = (y: number) => act(() => r.root.find((n) => !isHost(n) && n.props.testID === 'legalReader.scroll' && typeof n.props.onScroll === 'function').props.onScroll({ nativeEvent: { contentOffset: { x: 0, y } } }));
  const close = () => act(() => r.root.find((n) => !isHost(n) && n.props.testID === 'legalReader.close' && typeof n.props.onPress === 'function').props.onPress());
  return { r, props, byId, all, texts, body, scroll, close, update: (p: Partial<LegalReaderProps>) => act(() => r.update(tree({ ...props, ...p }))), unmount: () => act(() => r.unmount()) };
}

const sendEvent = AccessibilityInfo.sendAccessibilityEvent as unknown as jest.Mock;
beforeEach(() => {
  timings().splice(0);
  sendEvent.mockClear();
});
afterEach(() => jest.restoreAllMocks());

describe('LegalReader: the TopBar', () => {
  it.each(['dark', 'light'] as const)('%s: an opaque ground fill, at least topBar.height plus the top inset, never a fixed height', (face) => {
    const view = mount({ face, insets: { top: TOP_INSET, bottom: BOTTOM_INSET } });
    expect(flat(view.byId('legalReader.topBar'))).toMatchObject({ backgroundColor: T.color[face].ground.hex, minHeight: BASE.topBar.height + TOP_INSET, paddingTop: TOP_INSET, flexDirection: 'row' });
    expect(flat(view.byId('legalReader.topBar'))).not.toHaveProperty('height');
    expect(flat(view.byId('legalReader'))).toMatchObject({ flex: 1, backgroundColor: T.color[face].ground.hex });
    view.unmount();
  });

  it.each(['latin', 'hebrew'] as const)('%s: the document’s own title in ui.title at its weight (500), a header, at the start, wrapping', (script) => {
    const view = mount({ script });
    const title = view.byId('legalReader.title');
    const type = BASE.type.ui.title[script];
    expect(title.props.children).toBe(DOC.title);
    expect(title.props.accessibilityRole).toBe('header');
    expect(flat(title)).toMatchObject({ ...fontFace(BASE.type.face.ui, T.type.ui.title.weight), fontSize: type.size, lineHeight: type.lineHeight, color: T.color.dark.text.primary.hex, textAlign: 'left', flex: 1 });
    expect(title.props.numberOfLines).toBeUndefined();
    view.unmount();
  });

  it('Close at the end: icon.m in a 48 target, the button role, the caller’s label; a press calls onClose once', () => {
    const onClose = jest.fn();
    const view = mount({ onClose });
    const kids = (view.byId('legalReader.topBar').children as Node[]).map((k) => k.props.testID);
    expect(kids).toEqual(['legalReader.title', 'legalReader.close']);
    const close = view.byId('legalReader.close');
    expect(close.props.accessibilityRole).toBe('button');
    expect(close.props.accessibilityLabel).toBe('Close');
    expect(flat(close)).toMatchObject({ width: BASE.target.min, height: BASE.target.min });
    expect(flat(view.byId('legalReader.close.glyph'))).toMatchObject({ width: BASE.icon.m, height: BASE.icon.m });
    view.close();
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('on open, TalkBack focus moves to the title, once', () => {
    const view = mount();
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent.mock.calls[0][1]).toBe('focus');
    view.update({ tier: 'still' });
    expect(sendEvent).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});

describe('LegalReader: the hairline under the TopBar', () => {
  it.each(['dark', 'light'] as const)('%s: 1 dp of line.control, in the flow from the start (no jump), shown only once the content scrolled', (face) => {
    const view = mount({ face });
    const line = () => view.byId('legalReader.hairline');
    expect(flat(line())).toMatchObject({ height: 1, backgroundColor: T.color[face].line.control.hex, opacity: 0 });
    view.scroll(40);
    expect(flat(line()).opacity).toBe(1);
    view.scroll(0);
    expect(flat(line()).opacity).toBe(0);
    view.unmount();
  });

  it('fades over motion.press at the full and low tiers, and is instant at the still tier (reduced motion)', () => {
    for (const tier of ['full', 'low', 'still'] as MotionTier[]) {
      timings().splice(0);
      const view = mount({ tier });
      view.scroll(10);
      view.scroll(20);
      expect([tier, timings().map((t) => [t.toValue, t.config.duration])]).toEqual([tier, [[1, tier === 'still' ? 0 : BASE.motion.press.duration]]]);
      view.unmount();
    }
  });
});

describe('LegalReader: the meta block (item 97: the current-text line first)', () => {
  it('the current-text line with the hosted address, LTR-isolated, then 4, then the version line with the document’s date', () => {
    const view = mount();
    const meta = view.byId('legalReader.meta').children as Node[];
    expect(meta.map((m) => m.props.testID)).toEqual(['legalReader.current', 'legalReader.version']);
    expect(view.byId('legalReader.current').props.children).toBe(`The current text is online at ${LRI}${ADDRESS}${PDI}.`);
    expect(view.byId('legalReader.version').props.children).toBe('Version 3, 1 March 2026.');
    expect(flat(view.byId('legalReader.version')).marginTop).toBe(BASE.spacing['2']);
    view.unmount();
  });

  it('the address is the prop, never one in the document: a different address shows, the document unchanged', () => {
    const view = mount({ address: 'https://example.net/terms' });
    expect(view.byId('legalReader.current').props.children).toContain(`${LRI}https://example.net/terms${PDI}`);
    view.unmount();
  });

  it.each(['latin', 'hebrew'] as const)('%s: ui.legal, text.secondary, selectable, never underlined or pressable', (script) => {
    const view = mount({ script });
    const type = BASE.type.ui.legal[script];
    for (const id of ['legalReader.current', 'legalReader.version']) {
      const n = view.byId(id);
      expect(flat(n)).toMatchObject({ ...fontFace(BASE.type.face.ui, type.weight), fontSize: type.size, lineHeight: type.lineHeight, color: T.color.dark.text.secondary.hex });
      expect(flat(n).textDecorationLine).toBeUndefined();
      expect([id, n.props.selectable, n.props.onPress]).toEqual([id, true, undefined]);
    }
    view.unmount();
  });

  it('the column: 24 below the TopBar, the meta, 32, the body; content.maxWidth, centred, within the gutter; 24 plus the bottom inset at the end', () => {
    const view = mount({ insets: { top: BASE.spacing['0'], bottom: BOTTOM_INSET } });
    expect(flat(view.byId('legalReader.column'))).toMatchObject({
      width: '100%',
      maxWidth: SPACE.measure,
      alignSelf: 'center',
      paddingHorizontal: T.layout.gutter,
      paddingTop: BASE.spacing['7'],
      paddingBottom: BASE.spacing['7'] + BOTTOM_INSET,
    });
    expect(flat(view.body()).marginTop).toBe(BASE.spacing['8']);
    view.unmount();
  });

  it('a marker the caller passes (the lab’s SAMPLE tag) sits above the meta, then 16; none is drawn without one', () => {
    const view = mount({ marker: <View testID="tag" /> });
    const kids = (view.byId('legalReader.column').children as Node[]).map((k) => k.props.testID);
    expect(kids).toEqual(['legalReader.marker', 'legalReader.meta', 'legalReader.body']);
    expect(flat(view.byId('legalReader.marker')).marginBottom).toBe(BASE.spacing['5']);
    view.unmount();
    const none = mount();
    expect(none.all((n) => n.props.testID === 'legalReader.marker')).toEqual([]);
    none.unmount();
  });
});

describe('LegalReader: the document body', () => {
  it('headings in ui.title at 500, text.primary, each a header, 32 above (none for the first), 8 below', () => {
    const view = mount();
    const headings = view.all((n) => n.props.testID === 'legalReader.block.heading');
    expect(headings.map((h) => h.props.children)).toEqual(['Who we are', 'Your choices']);
    for (const h of headings) {
      expect(h.props.accessibilityRole).toBe('header');
      expect(flat(h)).toMatchObject({ ...fontFace(BASE.type.face.ui, T.type.ui.title.weight), fontSize: BASE.type.ui.title.latin.size, color: T.color.dark.text.primary.hex });
    }
    // Each block's own host: the body's children are the Block elements.
    const blocks = (view.body().children as Node[]).map((b) => (isHost(b) ? b : b.findAll(isHost)[0]));
    expect(blocks.map((b) => b.props.testID)).toEqual(['heading', 'paragraph', 'list', 'heading', 'list', 'paragraph'].map((k) => `legalReader.block.${k}`));
    expect(blocks.map((b) => flat(b).marginTop)).toEqual([0, SPACE.headingGapBelow, SPACE.paragraphGap, SPACE.headingGapAbove, SPACE.headingGapBelow, SPACE.paragraphGap]);
    view.unmount();
  });

  it('paragraphs in ui.body, text.primary, selectable, the focus token as the highlight, their addresses LTR-isolated and plain', () => {
    const view = mount();
    const [first] = view.all((n) => n.props.testID === 'legalReader.block.paragraph');
    expect(first.props.children).toBe(`Write to ${LRI}privacy@example.org${PDI} or read ${LRI}https://example.org/privacy${PDI}.`);
    expect(first.props.selectable).toBe(true);
    expect(first.props.selectionColor).toBe(T.color.dark.focus.hex);
    expect(flat(first)).toMatchObject({ ...fontFace(BASE.type.face.ui, BASE.type.ui.body.latin.weight), fontSize: BASE.type.ui.body.latin.size, color: T.color.dark.text.primary.hex });
    view.unmount();
  });

  it('a list: each item a row, its marker in ui.body text.secondary in a hanging column of listIndent, the text at flex 1, 8 between items', () => {
    const view = mount();
    const lists = view.all((n) => n.props.testID === 'legalReader.block.list');
    expect(lists.map((l) => l.props.role)).toEqual(['list', 'list']);
    const items = (l: Node) => l.children as Node[];
    expect(items(lists[0]).map((i) => i.props.role)).toEqual(['listitem', 'listitem']);
    expect(items(lists[0]).map((i) => flat(i).marginTop)).toEqual([undefined, SPACE.listItemGap]);
    for (const item of items(lists[1])) expect(flat(item)).toMatchObject({ flexDirection: 'row', alignItems: 'flex-start' });
    const markers = view.all((n) => n.props.testID === 'legalReader.list.marker');
    expect(markers.map((m) => (m.children[0] as Node).props.children)).toEqual(['•', '•', '1.', '2.', '3.']);
    for (const m of markers) {
      expect(flat(m)).toMatchObject({ width: SPACE.listIndent });
      expect(flat(m.children[0] as Node)).toMatchObject({ color: T.color.dark.text.secondary.hex, fontSize: BASE.type.ui.body.latin.size });
    }
    // A bullet is not read; a number is (it is the item's place).
    expect(markers.slice(0, 2).map((m) => m.props.importantForAccessibility)).toEqual(['no-hide-descendants', 'no-hide-descendants']);
    expect(markers.slice(2).map((m) => m.props.importantForAccessibility)).toEqual(['auto', 'auto', 'auto']);
    const itemText = view.all((n) => n.props.testID === 'legalReader.list.text');
    expect(itemText.map((t) => t.props.children)).toEqual(['First', 'Second', 'One', 'Two', 'Three']);
    for (const t of itemText) expect([flat(t).flex, t.props.selectable]).toEqual([1, true]);
    view.unmount();
  });

  it('nothing inside the document is pressable or a link: the one pressable in the reader is Close', () => {
    const view = mount();
    const inBody = view.body().findAll(() => true);
    for (const n of inBody) {
      for (const prop of ['onPress', 'onLongPress', 'onPressIn', 'onClick']) expect([n.props.testID, prop, n.props[prop]]).toEqual([n.props.testID, prop, undefined]);
      expect([n.props.testID, n.props.accessibilityRole]).not.toEqual([n.props.testID, 'link']);
      expect([n.props.testID, n.props.role]).not.toEqual([n.props.testID, 'link']);
      expect([n.props.testID, n.props.dataDetectorType ?? 'none']).toEqual([n.props.testID, 'none']);
    }
    const pressables = view.r.root.findAll((n) => !isHost(n) && typeof n.props.onPress === 'function').map((n) => n.props.testID);
    expect([...new Set(pressables)]).toEqual(['legalReader.close']);
    view.unmount();
  });

  it('no text is ever capped, scaled down or ellipsised', () => {
    const view = mount();
    for (const t of view.texts()) {
      for (const prop of ['numberOfLines', 'adjustsFontSizeToFit', 'maxFontSizeMultiplier', 'ellipsizeMode']) expect([t.props.testID, prop, t.props[prop]]).toEqual([t.props.testID, prop, undefined]);
    }
    view.unmount();
  });

  it('never the alert role or a live region anywhere', () => {
    const view = mount();
    for (const n of view.all(() => true)) {
      expect([n.props.testID, n.props.accessibilityRole]).not.toEqual([n.props.testID, 'alert']);
      expect(['polite', 'assertive']).not.toContain(n.props.accessibilityLiveRegion);
    }
    view.unmount();
  });
});

// CMP-122 (P1-D5): every word the reader draws is in Heebo, ui.title, ui.body or ui.legal, never the voice face. The check
// reads each drawn Text's face, and the planted tree below must fail it.
function nonHeeboFaces(root: Node): string[] {
  return root
    .findAllByType(Text)
    .map((n) => String((StyleSheet.flatten(n.props.style) ?? {}).fontFamily ?? '(none)'))
    .filter((f) => !/^Heebo(-|$)/.test(f));
}

describe('LegalReader: Heebo only (CMP-122)', () => {
  it.each(['latin', 'hebrew'] as const)('%s: every text it draws is in a Heebo face, and some text is drawn', (script) => {
    const view = mount({ script });
    expect(view.r.root.findAllByType(Text).length).toBeGreaterThan(10);
    expect(nonHeeboFaces(view.r.root)).toEqual([]);
    view.unmount();
  });

  it('planted: the check sees a Bellefair line, and a line with no face', () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <View>
          <Text style={{ fontFamily: 'Heebo-Regular' }}>a</Text>
          <Text style={[{ fontFamily: 'Bellefair-Regular' }]}>b</Text>
          <Text>c</Text>
        </View>,
      );
    });
    expect(nonHeeboFaces(r.root)).toEqual(['Bellefair-Regular', '(none)']);
    act(() => r.unmount());
  });
});

describe('LegalReader: RTL', () => {
  it('mirrors with the page: no side named, no direction set, nothing absolute', () => {
    for (const rtl of [false, true]) {
      jest.replaceProperty(I18nManager, 'isRTL', rtl);
      const view = mount({ script: 'hebrew' });
      for (const n of view.all(() => true)) {
        const s = flat(n);
        expect([n.props.testID, s.direction, s.position, s.left, s.right, s.marginLeft, s.marginRight, s.paddingLeft, s.paddingRight]).toEqual([
          n.props.testID, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        ]);
      }
      view.unmount();
    }
  });
});
