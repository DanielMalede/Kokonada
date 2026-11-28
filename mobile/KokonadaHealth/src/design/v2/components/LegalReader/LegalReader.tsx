// The LegalReader (F10; P1 spec §B, DEC-194 items 88, 89 and 97): the bundled privacy policy or terms of use, shown without
// leaving the app. It is the content of the modal `P1.legalDoc` that LegalDocRoute.tsx presents over the mounted screen; the
// route owns the open and close fade (P1 §4), the system back, the insets and where focus returns.
//
//   · Injected, never imported: the document, the hosted address and every line around it come from the caller
//     (ShellPorts.links.resolveLegalDoc and the bound address; the lab's sample document and a reserved example address).
//     Nothing it reaches opens a URL, makes a request or reads src/legal/** (legalReaderClosure.test.ts). Offline is the
//     same pixels: there is no loading state, no error state and no spinner.
//   · Anatomy, top to bottom (§B.1): the TopBar, opaque on the ground, at least topBar.height plus the top inset: the
//     document's own title (ui.title, a header, at the start, wrapping) and Close at the end (icon.m in a 48 target). A 1 dp
//     line.control hairline under it once the content has scrolled, none at the top, fading over motion.press (instant at the
//     still tier). Then the column (content.maxWidth, centred, within the gutter): 24; the caller's marker when it passes one
//     (the lab's SAMPLE tag), then 16; the meta block, whose top line is the current-text line with the hosted address
//     (item 97), then 4, the version line; 32; the body; and 24 plus the bottom inset.
//   · The body (§B.1 item 4): section headings in ui.title at its weight, each a header; paragraphs in ui.body; lists as
//     rows, a marker in a hanging column, the text at flex 1. All of it selectable, its highlight the selection token, and
//     nothing in it pressable, a link or underlined: an address in the text is plain, LTR-isolated text.
//   · Heebo only (CMP-122): every word is ui.title, ui.body or ui.legal in its face's own file. It reads no voice token.
//   · Never capped, scaled down or ellipsised; at font 2.0 everything reflows, the TopBar grows, and the column scrolls.
//   · TalkBack: focus moves to the title on open; the order is the title, Close, the current-text line, the version, then
//     the body, heading by heading. Never the alert role or a live region.
//   · It mirrors with the page: no side is named and no direction set.

import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type TextStyle,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import { useTokens, type Tokens } from '../../tokens/useTokens.ts';
import { fontFace } from '../../typeface/faces.ts';
import { blockGaps, isolateAddresses, listMarker, LRI, PDI, type LegalBlock, type LegalDocument } from './legalDocument.ts';
import { readerSpace } from './readerSpace.ts';

export type { LegalBlock, LegalDocument } from './legalDocument.ts';

/** The scripts the reader's type is set for: the keys of ui.body (LEDGER §5.4). */
export type ReaderScript = keyof Tokens['base']['type']['ui']['body'];

/** The meta block's two lines, resolved by the caller through its copy port (legal.reader.online, legal.reader.version). */
export interface ReaderLines {
  /** The current-text line, given the hosted address already LTR-isolated. */
  readonly current: (address: string) => string;
  /** The version line, given the document's version and its own preformatted date. */
  readonly version: (version: string, dateLabel: string) => string;
}

export interface LegalReaderProps {
  readonly document: LegalDocument;
  /** The script the document is set in, for its line heights (LEDGER §5.4). */
  readonly script: ReaderScript;
  /** The hosted address of the current text: the bound PRIVACY_POLICY_URL or TERMS_OF_USE_URL, or the lab's example address. */
  readonly address: string;
  readonly lines: ReaderLines;
  /** Close's accessibility label (legal.reader.close). */
  readonly closeLabel: string;
  readonly onClose: () => void;
  /** The motion tier (useMotionPolicy): the still tier is reduced motion. */
  readonly tier: MotionTier;
  /** The safe-area insets the route measured. */
  readonly insets?: { readonly top: number; readonly bottom: number };
  /** Lab only: the SAMPLE tag drawn above the meta block (P1 §B.1 item 2). */
  readonly marker?: React.ReactNode;
}

type Role = 'title' | 'body' | 'legal';

export function LegalReader({ document, script, address, lines, closeLabel, onClose, tier, insets = { top: 0, bottom: 0 }, marker }: LegalReaderProps) {
  const tokens = useTokens();
  const space = readerSpace(tokens);
  const c = tokens.color;
  const ui = tokens.base.type.ui;
  const type = (role: Role, color: string): TextStyle => {
    const t = ui[role][script];
    const weight = role === 'title' ? tokens.direction.type.ui.title.weight : ui[role][script].weight;
    return { ...fontFace(tokens.base.type.face.ui, weight), fontSize: t.size, lineHeight: t.lineHeight, letterSpacing: t.tracking * t.size, color };
  };
  const primary = c.text.primary.hex;
  const secondary = c.text.secondary.hex;
  // The highlight behind selected text: its own token, which keeps text.primary and text.secondary at 4.5:1 over it
  // (UI-336; the focus token is text.primary in Abyss and hid the selection).
  const selection = c.selection.hex;

  // TalkBack focus on the title when the reader opens, once.
  const title = useRef<React.ComponentRef<typeof Text>>(null);
  useEffect(() => {
    if (title.current) AccessibilityInfo.sendAccessibilityEvent(title.current as never, 'focus');
  }, []);

  // The hairline: shown once the content has scrolled, faded over motion.press, instant at the still tier.
  const [scrolled, setScrolled] = useState(false);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setScrolled(e.nativeEvent.contentOffset.y > 0);
  const opacity = useSharedValue(0);
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current === scrolled) return;
    shown.current = scrolled;
    const press = tokens.base.motion.press;
    const [x1, y1, x2, y2] = press.easing;
    opacity.value = withTiming(scrolled ? 1 : 0, { duration: tier === 'still' ? 0 : press.duration, easing: Easing.bezier(x1, y1, x2, y2) });
  }, [scrolled, tier, tokens, opacity]);
  const hairline = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const icon = tokens.base.icon.m;
  const stroke = tokens.base.icon.stroke;
  const crossBar = icon * tokens.base.glyph.closeBar;
  const target = tokens.base.target.min;
  const gutter = tokens.direction.layout.gutter;
  const gaps = blockGaps(document.blocks, space);

  return (
    <View testID="legalReader" style={[styles.root, { backgroundColor: c.ground.hex }]}>
      <View
        testID="legalReader.topBar"
        style={[
          styles.topBar,
          {
            backgroundColor: c.ground.hex,
            minHeight: tokens.base.topBar.height + insets.top,
            paddingTop: insets.top,
            paddingStart: gutter,
            // Close's glyph sits on the gutter: its 48 target overhangs it by half the difference.
            paddingEnd: gutter - (target - icon) / 2,
          },
        ]}
      >
        <Text ref={title} testID="legalReader.title" accessibilityRole="header" style={[styles.start, styles.title, type('title', primary)]}>
          {document.title}
        </Text>
        <Pressable
          testID="legalReader.close"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          style={[styles.close, { width: target, height: target }]}
        >
          {/* Close's cross, two bars in the glyph group's proportion. Interim only: the DT-10 Icon set replaces the drawn
              cross, and the glyph group with it, when it lands (UI-340). */}
          <View testID="legalReader.close.glyph" style={[styles.glyph, { width: icon, height: icon }]}>
            <View testID="legalReader.close.bar" style={[styles.bar, { width: crossBar, height: stroke, backgroundColor: primary, transform: [{ rotate: '45deg' }] }]} />
            <View
              testID="legalReader.close.bar"
              style={[styles.bar, { width: crossBar, height: stroke, marginTop: -stroke, backgroundColor: primary, transform: [{ rotate: '-45deg' }] }]}
            />
          </View>
        </Pressable>
      </View>
      {/* The hairline under the TopBar: topBar.hairline, 1 dp (P1 spec §B.1 item 1), in the flow from the start so it never
          moves the content. */}
      <Animated.View testID="legalReader.hairline" style={[{ height: tokens.base.topBar.hairline, backgroundColor: c.line.control.hex }, hairline]} />
      <ScrollView testID="legalReader.scroll" onScroll={onScroll} scrollEventThrottle={16}>
        <View
          testID="legalReader.column"
          style={[
            styles.column,
            {
              maxWidth: space.measure,
              paddingHorizontal: gutter,
              paddingTop: tokens.base.spacing['7'],
              paddingBottom: tokens.base.spacing['7'] + insets.bottom,
            },
          ]}
        >
          {marker !== undefined && (
            <View testID="legalReader.marker" style={{ marginBottom: tokens.base.spacing['5'] }}>
              {marker}
            </View>
          )}
          <View testID="legalReader.meta">
            <Text testID="legalReader.current" selectable selectionColor={selection} style={[styles.start, type('legal', secondary)]}>
              {lines.current(`${LRI}${address}${PDI}`)}
            </Text>
            <Text
              testID="legalReader.version"
              selectable
              selectionColor={selection}
              style={[styles.start, type('legal', secondary), { marginTop: tokens.base.spacing['2'] }]}
            >
              {lines.version(document.version, document.dateLabel)}
            </Text>
          </View>
          <View testID="legalReader.body" style={{ marginTop: tokens.base.spacing['8'] }}>
            {document.blocks.map((block, i) => (
              <Block
                key={i}
                block={block}
                gapAbove={gaps[i]}
                headingGapBelow={space.headingGapBelow}
                listIndent={space.listIndent}
                listItemGap={space.listItemGap}
                heading={type('title', primary)}
                body={type('body', primary)}
                marker={type('body', secondary)}
                selection={selection}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

interface BlockProps {
  readonly block: LegalBlock;
  readonly gapAbove: number;
  readonly headingGapBelow: number;
  readonly listIndent: number;
  readonly listItemGap: number;
  readonly heading: TextStyle;
  readonly body: TextStyle;
  readonly marker: TextStyle;
  readonly selection: string;
}

function Block({ block, gapAbove, listIndent, listItemGap, heading, body, marker, selection }: BlockProps) {
  if (block.kind === 'heading') {
    return (
      <Text testID="legalReader.block.heading" accessibilityRole="header" selectable selectionColor={selection} style={[styles.start, heading, { marginTop: gapAbove }]}>
        {block.text}
      </Text>
    );
  }
  if (block.kind === 'paragraph') {
    return (
      <Text testID="legalReader.block.paragraph" selectable selectionColor={selection} style={[styles.start, body, { marginTop: gapAbove }]}>
        {isolateAddresses(block.text)}
      </Text>
    );
  }
  const ordered = block.ordered === true;
  return (
    <View testID="legalReader.block.list" role="list" style={{ marginTop: gapAbove }}>
      {block.items.map((item, i) => (
        <View key={i} role="listitem" style={[styles.item, i > 0 && { marginTop: listItemGap }]}>
          <View
            testID="legalReader.list.marker"
            style={{ width: listIndent }}
            // A bullet is not read; an item's number is its place, and is.
            importantForAccessibility={ordered ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!ordered}
          >
            <Text style={[styles.start, marker]}>{listMarker(ordered, i)}</Text>
          </View>
          <Text testID="legalReader.list.text" selectable selectionColor={selection} style={[styles.start, body, styles.itemText]}>
            {isolateAddresses(item)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1 },
  close: { alignItems: 'center', justifyContent: 'center' },
  glyph: { alignItems: 'center', justifyContent: 'center' },
  bar: {},
  column: { width: '100%', alignSelf: 'center' },
  item: { flexDirection: 'row', alignItems: 'flex-start' },
  itemText: { flex: 1 },
  // React Native lays 'left' at the paragraph's start, the right under RTL (as the Well's hint).
  start: { textAlign: 'left' },
});
