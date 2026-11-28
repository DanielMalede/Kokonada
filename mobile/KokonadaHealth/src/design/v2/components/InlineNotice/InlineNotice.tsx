// The InlineNotice (F10; P1 spec §3, §3.1 and A.1, P11 spec §3; the architect's build note E, DEC-198): an info notice in
// the flow of the page, ink only and as wide as the column. One kind, info: it never carries a state colour, a tint, the
// alert role or a live region (the page's Announcer speaks it once, LEDGER §10), and it never takes focus.
//
//   · Anatomy: notice.surface inside a notice.border keyline at notice.radius, padded by notice.padding. In it a row: the
//     notice glyph (icon.s, text.secondary) at the start, top-aligned to the text's first line by the type token and the
//     window's font scale; notice.iconGap; then the text column at flex 1: the body (ui.body, text.primary, never capped,
//     scaled or ellipsised), and when there are actions, spacing.3 below it, the actions.
//   · Actions (build note E): zero, one or two, in reading order, and the type takes a link only first. Each is a row at
//     least target.min (48) tall and wide. A link is ui.body, text.primary, underlined, with the link role; a button the
//     same ink, not underlined, with the button role. One action sits at the start of the text. Two share one row, the
//     link at the start and the button at the end, only when their measured widths and the gap fit the column; otherwise
//     they stack, the link first (actionLayout.ts). Each action keeps its own width in both layouts, so the widths it
//     reports are the label's and never the layout's.
//   · Presentational only: every word, hint and handler is the caller's. Nothing it reaches opens a URL, reads a copy
//     catalog or a legal module (inlineNoticeClosure.test.ts).
//   · `selectable` makes the body selectable (the policy notice's address), its highlight the focus token.
//   · It mirrors with the page: no side is named and no direction set.

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent, type TextStyle } from 'react-native';
import { useTokens, type Tokens } from '../../tokens/useTokens.ts';
import { fontFace } from '../../typeface/faces.ts';
import { glyphOffset, noticeActionLayout } from './actionLayout.ts';

/** The scripts the notice's type is set for: the keys of ui.body (LEDGER §5.4). */
export type NoticeScript = keyof Tokens['base']['type']['ui']['body'];

interface NoticeActionBase {
  /** The caller's label, resolved through its copy port or bound constant. */
  readonly label: string;
  readonly onPress: () => void;
  /** What TalkBack adds after the label, when the caller has a true one (P1 §3.1: the policy link's hint). */
  readonly accessibilityHint?: string;
}
/** A link: underlined, the link role. The caller's handler opens what it opens; the notice opens nothing. */
export interface NoticeLinkAction extends NoticeActionBase {
  readonly kind: 'link';
}
/** A text button: the same ink, not underlined, the button role (a dismiss). */
export interface NoticeButtonAction extends NoticeActionBase {
  readonly kind: 'button';
}
export type NoticeAction = NoticeLinkAction | NoticeButtonAction;
/** Zero, one or two actions in reading order; with two, the link first (build note E). */
export type NoticeActions = readonly [] | readonly [NoticeAction] | readonly [NoticeLinkAction, NoticeButtonAction];

export interface InlineNoticeProps {
  /** The notice's words, resolved by the caller. An address in them is the caller's to LTR-isolate. */
  readonly body: string;
  /** The script the words are set in, for their line height (LEDGER §5.4). */
  readonly script: NoticeScript;
  /** The body can be selected and copied (the policy notice's address). */
  readonly selectable?: boolean;
  readonly actions?: NoticeActions;
  readonly testID?: string;
}

/** The space between the link and the button when they share a row. */
const gapOf = (tokens: Tokens) => tokens.base.spacing['5'];

export function InlineNotice({ body, script, selectable = false, actions = [], testID = 'inlineNotice' }: InlineNoticeProps) {
  const tokens = useTokens();
  const { fontScale } = useWindowDimensions();
  const type = tokens.base.type.ui.body[script];
  const ink: TextStyle = {
    ...fontFace(tokens.base.type.face.ui, type.weight),
    fontSize: type.size,
    lineHeight: type.lineHeight,
    letterSpacing: type.tracking * type.size,
    color: tokens.color.text.primary.hex,
  };

  const [column, setColumn] = useState<number | null>(null);
  const [widths, setWidths] = useState<readonly (number | null)[]>(() => actions.map(() => null));
  const measured = widths.length === actions.length ? widths : actions.map(() => null);
  const layout = noticeActionLayout(column, measured, gapOf(tokens));
  const onColumn = useCallback((e: LayoutChangeEvent) => setColumn(e.nativeEvent.layout.width), []);
  const onAction = useCallback(
    (i: number, count: number) => (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      setWidths((prev) => {
        const next = prev.length === count ? [...prev] : Array.from({ length: count }, () => null as number | null);
        next[i] = w;
        return next;
      });
    },
    [],
  );

  const icon = tokens.base.icon.s;
  const glyphStyle = { width: icon, height: icon, marginTop: glyphOffset(type.lineHeight, fontScale, icon) };
  const glyphInk = tokens.color.text.secondary.hex;

  return (
    <View
      testID={testID}
      style={[
        styles.box,
        {
          backgroundColor: tokens.color.notice.surface.hex,
          borderColor: tokens.color.notice.border.hex,
          borderWidth: tokens.direction.notice.border,
          borderRadius: tokens.direction.notice.radius,
          paddingHorizontal: tokens.direction.notice.padding.horizontal,
          paddingVertical: tokens.direction.notice.padding.vertical,
        },
      ]}
    >
      <View testID={`${testID}.glyph`} style={glyphStyle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View
          testID={`${testID}.glyph.ring`}
          style={[styles.ring, { borderWidth: tokens.base.icon.stroke, borderColor: glyphInk, borderRadius: icon / 2 }]}
        >
          {/* The info mark: a dot over a bar, drawn in the ring's ink. The Icon set (DT-10) replaces it when it lands. */}
          <View style={{ width: tokens.base.icon.stroke * 1.5, height: tokens.base.icon.stroke * 1.5, borderRadius: tokens.base.icon.stroke, backgroundColor: glyphInk }} />
          <View style={{ width: tokens.base.icon.stroke, height: icon * 0.35, marginTop: tokens.base.spacing['1'], backgroundColor: glyphInk }} />
        </View>
      </View>
      <View testID={`${testID}.column`} style={[styles.column, { marginStart: tokens.direction.notice.iconGap }]}>
        <Text
          testID={`${testID}.body`}
          style={[styles.start, ink]}
          selectable={selectable}
          selectionColor={selectable ? tokens.color.focus.hex : undefined}
        >
          {body}
        </Text>
        {actions.length > 0 && (
          <View
            testID={`${testID}.actions`}
            onLayout={onColumn}
            style={[
              { marginTop: tokens.base.spacing['3'] },
              actions.length === 1 ? styles.single : layout === 'row' ? styles.row : styles.stack,
            ]}
          >
            {actions.map((action, i) => (
              <Pressable
                key={i}
                testID={`${testID}.action.${i}`}
                onPress={action.onPress}
                onLayout={onAction(i, actions.length)}
                accessibilityRole={action.kind === 'link' ? 'link' : 'button'}
                accessibilityHint={action.accessibilityHint}
                style={[styles.action, { minHeight: tokens.base.target.min, minWidth: tokens.base.target.min }]}
              >
                <Text testID={`${testID}.action.${i}.label`} style={[styles.start, ink, action.kind === 'link' && styles.underline]}>
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start' },
  ring: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  column: { flex: 1 },
  // React Native lays 'left' at the paragraph's start, the right under RTL (as the Well's hint).
  start: { textAlign: 'left' },
  single: { flexDirection: 'row', justifyContent: 'flex-start' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  action: { justifyContent: 'center', flexShrink: 0 },
  underline: { textDecorationLine: 'underline' },
});
