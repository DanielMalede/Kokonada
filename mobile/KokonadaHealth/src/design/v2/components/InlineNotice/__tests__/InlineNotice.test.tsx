import React from 'react';
import { Dimensions, I18nManager, StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { DirectionProvider } from '../../../tokens/DirectionProvider.tsx';
import { BASE, DIRECTIONS, type Face } from '../../../tokens/tokens.generated.ts';
import { fontFace } from '../../../typeface/faces.ts';
import { InlineNotice, type InlineNoticeProps, type NoticeButtonAction, type NoticeLinkAction } from '../InlineNotice.tsx';

// The F10 InlineNotice (P1 spec §3 and §3.1, A.1; P11 spec §3; the architect's build note E, DEC-198): an info notice, ink
// only, as wide as the column. Presentational: its words and its handlers are the caller's. Zero, one or two actions (the
// sign-in-incomplete line and P11's errors; the readings notice; the policy notice), each a 48 dp row, the link first;
// the two stack when the measured widths do not fit one row.

type Node = ReactTestRenderer.ReactTestInstance;
const flat = (n: Node) => StyleSheet.flatten(n.props.style) ?? {};
const isHost = (n: Node) => typeof n.type === 'string';
const T = DIRECTIONS.abyss;

const BODY = 'Our privacy policy changed. The current text is at \u2068https://example.org/privacy\u2069.';
const link = (onPress = jest.fn()): NoticeLinkAction => ({ kind: 'link', label: 'Privacy policy', onPress, accessibilityHint: 'Opens in your browser' });
const dismiss = (onPress = jest.fn()): NoticeButtonAction => ({ kind: 'button', label: 'Dismiss', onPress });

function mount(props: InlineNoticeProps, face: Face = 'dark') {
  const tree = (p: InlineNoticeProps) => (
    <DirectionProvider direction="abyss" face={face}>
      <InlineNotice {...p} />
    </DirectionProvider>
  );
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(tree(props));
  });
  const byId = (id: string) => r.root.find((n) => isHost(n) && n.props.testID === id);
  const all = (id: string) => r.root.findAll((n) => isHost(n) && n.props.testID === id);
  const actions = () => r.root.findAll((n) => isHost(n) && typeof n.props.testID === 'string' && /^inlineNotice\.action\.\d+$/.test(n.props.testID));
  const layout = (id: string, width: number) => act(() => byId(id).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 48 } } }));
  /** Presses action i through its Pressable, as a tap does: the element's own onPress, never a prop of the host View. */
  const press = (i: number) => act(() => r.root.find((n) => !isHost(n) && n.props.testID === `inlineNotice.action.${i}` && typeof n.props.onPress === 'function').props.onPress());
  const texts = () => r.root.findAll((n) => isHost(n) && String(n.type) === 'Text');
  return { r, byId, all, actions, layout, press, texts, update: (p: InlineNoticeProps) => act(() => r.update(tree(p))), unmount: () => act(() => r.unmount()) };
}

afterEach(() => jest.restoreAllMocks());

describe('InlineNotice: the box', () => {
  it.each(['dark', 'light'] as const)('%s: notice.surface inside a notice.border keyline at notice.radius, padded by notice.padding, as wide as the column', (face) => {
    const view = mount({ body: BODY, script: 'latin' }, face);
    expect(flat(view.byId('inlineNotice'))).toMatchObject({
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: T.color[face].notice.surface.hex,
      borderColor: T.color[face].notice.border.hex,
      borderWidth: T.notice.border,
      borderRadius: T.notice.radius,
      paddingHorizontal: T.notice.padding.horizontal,
      paddingVertical: T.notice.padding.vertical,
    });
    view.unmount();
  });

  it('the glyph first, then notice.iconGap (12), then the text column at flex 1', () => {
    const view = mount({ body: BODY, script: 'latin' });
    const kids = view.byId('inlineNotice').children as Node[];
    expect(kids.map((k) => k.props.testID)).toEqual(['inlineNotice.glyph', 'inlineNotice.column']);
    expect(flat(view.byId('inlineNotice.column'))).toMatchObject({ flex: 1, marginStart: T.notice.iconGap });
    view.unmount();
  });

  it('mirrors with the page: no side is named, no direction is set, nothing is placed absolutely', () => {
    for (const rtl of [false, true]) {
      jest.replaceProperty(I18nManager, 'isRTL', rtl);
      const view = mount({ body: BODY, script: 'hebrew', actions: [link(), dismiss()] });
      for (const n of view.r.root.findAll(isHost)) {
        const s = flat(n);
        expect([n.props.testID, s.direction, s.position, s.left, s.right, s.marginLeft, s.marginRight, s.paddingLeft, s.paddingRight]).toEqual([
          n.props.testID, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        ]);
      }
      view.unmount();
    }
  });
});

describe('InlineNotice: the glyph', () => {
  it.each(['dark', 'light'] as const)('%s: icon.s (20), a ring in text.secondary at icon.stroke, hidden from TalkBack', (face) => {
    const view = mount({ body: BODY, script: 'latin' }, face);
    const glyph = view.byId('inlineNotice.glyph');
    expect(flat(glyph)).toMatchObject({ width: BASE.icon.s, height: BASE.icon.s });
    expect(flat(view.byId('inlineNotice.glyph.ring'))).toMatchObject({ borderWidth: BASE.icon.stroke, borderColor: T.color[face].text.secondary.hex, borderRadius: BASE.icon.s / 2 });
    expect(glyph.props.accessibilityElementsHidden).toBe(true);
    expect(glyph.props.importantForAccessibility).toBe('no-hide-descendants');
    view.unmount();
  });

  it('top-aligned to the first line from the type token and the window’s font scale: 2 at 1.0, 14 at 2.0 in Latin, 16 at 2.0 in Hebrew', () => {
    const window = Dimensions.get('window');
    for (const [scale, script, want] of [[1, 'latin', 2], [2, 'latin', 14], [2, 'hebrew', 16]] as const) {
      jest.spyOn(Dimensions, 'get').mockReturnValue({ ...window, fontScale: scale });
      const view = mount({ body: BODY, script });
      expect([scale, script, flat(view.byId('inlineNotice.glyph')).marginTop]).toEqual([scale, script, want]);
      view.unmount();
      jest.restoreAllMocks();
    }
  });
});

describe('InlineNotice: the body', () => {
  it.each(['latin', 'hebrew'] as const)('%s: ui.body in its face’s own file, text.primary, never capped or scaled', (script) => {
    const view = mount({ body: BODY, script });
    const body = view.byId('inlineNotice.body');
    const type = BASE.type.ui.body[script];
    expect(body.props.children).toBe(BODY);
    expect(flat(body)).toMatchObject({ ...fontFace(BASE.type.face.ui, type.weight), fontSize: type.size, lineHeight: type.lineHeight, color: T.color.dark.text.primary.hex, textAlign: 'left' });
    for (const prop of ['numberOfLines', 'adjustsFontSizeToFit', 'maxFontSizeMultiplier', 'ellipsizeMode']) expect([prop, body.props[prop]]).toEqual([prop, undefined]);
    view.unmount();
  });

  it('is selectable only when the caller asks (the policy notice’s address), with the focus token as its highlight', () => {
    const plain = mount({ body: BODY, script: 'latin' });
    expect(plain.byId('inlineNotice.body').props.selectable).toBeFalsy();
    plain.unmount();
    const sel = mount({ body: BODY, script: 'latin', selectable: true });
    expect(sel.byId('inlineNotice.body').props.selectable).toBe(true);
    expect(sel.byId('inlineNotice.body').props.selectionColor).toBe(T.color.dark.focus.hex);
    sel.unmount();
  });

  it('is plain text: never the alert role, never a live region, nothing pressable in it (the page’s Announcer speaks)', () => {
    const view = mount({ body: BODY, script: 'latin', actions: [link(), dismiss()] });
    for (const n of view.r.root.findAll(isHost)) {
      expect([n.props.testID, n.props.accessibilityRole]).not.toEqual([n.props.testID, 'alert']);
      expect([n.props.testID, n.props.role]).not.toEqual([n.props.testID, 'alert']);
      expect(['polite', 'assertive']).not.toContain(n.props.accessibilityLiveRegion);
    }
    expect(view.byId('inlineNotice.body').props.onPress).toBeUndefined();
    view.unmount();
  });
});

describe('InlineNotice: the actions (build note E)', () => {
  it('with none, no action row is drawn at all: the sign-in-incomplete line and P11’s errors', () => {
    const view = mount({ body: BODY, script: 'latin' });
    expect(view.all('inlineNotice.actions')).toEqual([]);
    expect(view.actions()).toEqual([]);
    const empty = mount({ body: BODY, script: 'latin', actions: [] });
    expect(empty.all('inlineNotice.actions')).toEqual([]);
    view.unmount();
    empty.unmount();
  });

  it('with one, a text button 48 dp tall at the start of the text, 8 below it: the readings notice’s dismiss', () => {
    const onPress = jest.fn();
    const view = mount({ body: BODY, script: 'latin', actions: [dismiss(onPress)] });
    expect(flat(view.byId('inlineNotice.actions'))).toMatchObject({ marginTop: BASE.spacing['3'], flexDirection: 'row', justifyContent: 'flex-start' });
    const [only] = view.actions();
    expect(only.props.accessibilityRole).toBe('button');
    expect(flat(only)).toMatchObject({ minHeight: BASE.target.min, minWidth: BASE.target.min, justifyContent: 'center' });
    view.press(0);
    expect(onPress).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('with two, the link and then the button, each its own handler once, the link’s hint passed as given', () => {
    const onLink = jest.fn();
    const onDismiss = jest.fn();
    const view = mount({ body: BODY, script: 'latin', actions: [link(onLink), dismiss(onDismiss)] });
    const [first, second] = view.actions();
    expect([first.props.testID, first.props.accessibilityRole, first.props.accessibilityHint]).toEqual(['inlineNotice.action.0', 'link', 'Opens in your browser']);
    expect([second.props.testID, second.props.accessibilityRole, second.props.accessibilityHint]).toEqual(['inlineNotice.action.1', 'button', undefined]);
    view.press(0);
    expect([onLink.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 0]);
    view.press(1);
    expect([onLink.mock.calls.length, onDismiss.mock.calls.length]).toEqual([1, 1]);
    for (const a of [first, second]) expect(flat(a)).toMatchObject({ minHeight: BASE.target.min, minWidth: BASE.target.min, flexShrink: 0 });
    view.unmount();
  });

  it('the link is ui.body, text.primary, underlined; the button the same ink with no underline (ink only, never tinted)', () => {
    const view = mount({ body: BODY, script: 'latin', actions: [link(), dismiss()] }, 'light');
    const label = (i: number) => view.byId(`inlineNotice.action.${i}.label`);
    const type = BASE.type.ui.body.latin;
    for (const i of [0, 1]) expect(flat(label(i))).toMatchObject({ ...fontFace(BASE.type.face.ui, type.weight), fontSize: type.size, lineHeight: type.lineHeight, color: T.color.light.text.primary.hex });
    expect(flat(label(0)).textDecorationLine).toBe('underline');
    expect(flat(label(1)).textDecorationLine).toBeUndefined();
    expect([label(0).props.children, label(1).props.children]).toEqual(['Privacy policy', 'Dismiss']);
    view.unmount();
  });

  it('two stack until measured, then share a row when they fit, with the link at the start and the button at the end', () => {
    const view = mount({ body: BODY, script: 'latin', actions: [link(), dismiss()] });
    const row = () => flat(view.byId('inlineNotice.actions'));
    expect(row()).toMatchObject({ flexDirection: 'column', alignItems: 'flex-start' });
    view.layout('inlineNotice.actions', 300);
    view.layout('inlineNotice.action.0', 120);
    expect(row().flexDirection).toBe('column');
    view.layout('inlineNotice.action.1', 80);
    expect(row()).toMatchObject({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' });
    expect(view.actions().map((a) => a.props.testID)).toEqual(['inlineNotice.action.0', 'inlineNotice.action.1']);
    view.unmount();
  });

  it('stacks again when the column narrows (font 2.0, a rotation), and unstacks when it widens: the widths are the labels’ own in both', () => {
    const view = mount({ body: BODY, script: 'latin', actions: [link(), dismiss()] });
    const direction = () => flat(view.byId('inlineNotice.actions')).flexDirection;
    view.layout('inlineNotice.actions', 300);
    view.layout('inlineNotice.action.0', 120);
    view.layout('inlineNotice.action.1', 80);
    expect(direction()).toBe('row');
    view.layout('inlineNotice.actions', 200);
    expect(direction()).toBe('column');
    // Stacked, each action keeps its own width (alignItems flex-start), so the same widths come back and it can unstack.
    view.layout('inlineNotice.action.0', 120);
    view.layout('inlineNotice.action.1', 80);
    view.layout('inlineNotice.actions', 300);
    expect(direction()).toBe('row');
    // The labels grow (font 2.0) in a column that keeps its width: stacked.
    view.layout('inlineNotice.action.0', 230);
    expect(direction()).toBe('column');
    view.unmount();
  });

  it('stacked, the link stays first and each is its own 48 dp row', () => {
    const view = mount({ body: BODY, script: 'latin', actions: [link(), dismiss()] });
    view.layout('inlineNotice.actions', 150);
    view.layout('inlineNotice.action.0', 120);
    view.layout('inlineNotice.action.1', 80);
    expect(flat(view.byId('inlineNotice.actions')).flexDirection).toBe('column');
    const [first, second] = view.actions();
    expect([first.props.accessibilityRole, second.props.accessibilityRole]).toEqual(['link', 'button']);
    for (const a of [first, second]) expect(flat(a).minHeight).toBe(BASE.target.min);
    view.unmount();
  });

  it('the type only takes the link first: three actions, or a button before a link, do not compile', () => {
    const ok: InlineNoticeProps['actions'][] = [[], [dismiss()], [link()], [link(), dismiss()]];
    expect(ok).toHaveLength(4);
    // @ts-expect-error a button before the link
    const swapped: InlineNoticeProps['actions'] = [dismiss(), link()];
    // @ts-expect-error three actions
    const three: InlineNoticeProps['actions'] = [link(), dismiss(), dismiss()];
    expect([swapped, three]).toHaveLength(2);
  });
});
