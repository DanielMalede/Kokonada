// RimLabels (F10 group A, G8-2a; DEC-036; DSN-027, DSN-028): the four axis words on the plate's ring, drawn over the
// field and under the beads, inside the Plate (its child, in plate-local dp).
//
//   · Each word is drawn on the arc by Skia (arc.ts says where, draw.ts draws it) and doubled as a real accessible text
//     node at the word's own box. TalkBack reads them in every locale top, bottom, right, left (RIM_READING_ORDER, the
//     designer's ruling 1). Android reads by place, never by mount order, so the root is the plate's words slot and each
//     node sits in a word slot of its own (Plate/readingOrder.ts), whose top alone orders it; the nodes are also mounted
//     in that order. The drawing is hidden from accessibility; the nodes
//     carry the page's accessible copy (plate.rim.a11y.*). No string is the component's own: the page resolves both
//     through the copy port (F10 R2).
//   · Type: type.face.ui at ui.label's size and weight, times the OS font scale with no cap (DSN-027), in the face's
//     text.primary. The bottom word takes plate.labelBand's tracking for its script. The font comes from `fontMgr`,
//     else the typeface provider's above the page (F6: the bundled faces), else the system's, which on Android has no
//     Heebo and answers a typeface with no glyphs.
//   · Left to right in every locale (R7, QA-088): the root is `direction: 'ltr'`, and each node is placed by its left and
//     top inside its slot, at the word's box in plate-local dp. A Hebrew word is laid in the order it is seen; the plate
//     itself never mirrors.
//   · The knock-out (DSN-028; the designer's ruling 2): letters near a live bead are not drawn, from the frame it appears.
//     Letters near leaving beads only are drawn in a returning picture of their own, one per set of beads they follow,
//     whose opacity is derived on the UI thread from those beads' own looks (lettersOpacity; UI-320, the designer's
//     rulings of 2026-11-26): 1 − the largest share of its start opacity a followed bead still has, so the letters are
//     exactly 0 while a bead is at its start opacity and can never run ahead of it, however late its motion starts.
//     Under reduced motion a bead is gone in one frame and its letters are kept in that frame. When the beads are gone
//     the letters are kept, drawn as they were. The node and its copy stay whole.
//   · At rest it is static: it redraws only when its words, its beads or its geometry change, and it has no clock of
//     its own: a returning layer is recomputed only in a frame the driver wrote a look. Each word's canvas is memoised
//     on what it draws, so a parent's re-render while letters return commits no canvas (a JS commit of a Skia canvas
//     draws a recording made on JS: an older frame after a newer one). Every picture and font it makes is freed once
//     replaced, and on unmount (RA-31).

import React, { memo, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Group, Paint, Picture, Skia, matchFont, type SkFontMgr, type SkPicture } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { useTokens, type Tokens } from '../../tokens/useTokens.ts';
import { useTypefaceFontMgr } from '../../typeface/TypefaceProvider.tsx';
import { plateGeometry } from '../Plate/geometry.ts';
import { plateSlot, rimWordSlot } from '../Plate/readingOrder.ts';
import {
  RIM_POSITIONS,
  RIM_READING_ORDER,
  layRimWord,
  lettersOpacity,
  returningGroups,
  visualOrder,
  type RimBead,
  type RimLooksValue,
  type RimPosition,
} from './arc.ts';
import { recordRimGlyphs, type RimWordSkia } from './draw.ts';

/** The scripts the rim words' type is set for: the keys of ui.label (LEDGER §5.4). */
export type RimScript = keyof Tokens['base']['type']['ui']['label'];

/** One string per rim position. */
export type RimWords = Readonly<Record<RimPosition, string>>;

type FontWeight = NonNullable<Parameters<typeof matchFont>[0]>['fontWeight'];

export interface RimLabelsProps {
  /** The plate's diameter and the OS font scale, exactly as the Plate was given them. */
  readonly diameter: number;
  readonly fontScale: number;
  /** The words on the arc, resolved by the page (plate.rim.top, .right, .bottom, .left). */
  readonly words: RimWords;
  /** What TalkBack reads at each word's place, resolved by the page (plate.rim.a11y.*). */
  readonly a11y: RimWords;
  /** The script the words are in: the bottom word's tracking (plate.labelBand). */
  readonly script: RimScript;
  /**
   * The beads on the plate, oldest first, as Bead/'s presence gives them: letters near a live bead are knocked out, and
   * letters near leaving beads only come back as those beads fade.
   */
  readonly beads: readonly RimBead[];
  /**
   * The looks the beads' driver writes on the UI thread, by bead id (Bead/'s useBeadPresence gives them; the page passes
   * them): the returning letters are derived from them in the frame they are written.
   */
  readonly looks: RimLooksValue;
  /**
   * The font manager to find type.face.ui in. When omitted, the typeface provider's above the page (F6), once its faces
   * are in; else the system's, which on Android has no Heebo and draws no glyph.
   */
  readonly fontMgr?: SkFontMgr;
}

const SKIA: RimWordSkia = { Skia };

const sameWords = (a: RimWords, b: RimWords) => RIM_POSITIONS.every((p) => a[p] === b[p]);

/** Two bead lists by value (RA-39): the same length, and at each place the same id, point and state (Object.is). */
const sameBeads = (a: readonly RimBead[], b: readonly RimBead[]) =>
  a.length === b.length &&
  a.every((x, i) => x.id === b[i].id && Object.is(x.point.x, b[i].point.x) && Object.is(x.point.y, b[i].point.y) && x.leaving === b[i].leaving);

/**
 * A returning group's key: the places of the beads it follows, never their indices, so its layer, and the value the
 * UI thread derives for it, stays while other beads come and go. Beads at one place reach the same letters, so they are
 * always followed together: no two groups of a word share a key.
 */
const followKey = (follows: readonly number[], beads: readonly RimBead[]) =>
  follows.map((k) => `${beads[k].point.x},${beads[k].point.y}`).join('|');

/** The value last seen, kept while each new one equals it: a page that rebuilds the same beads or words redraws nothing. */
function useByValue<T>(value: T, same: (a: T, b: T) => boolean): T {
  const [held, setHeld] = useState(value);
  if (held !== value && !same(held, value)) {
    setHeld(value);
    return value;
  }
  return held;
}

interface ReturningLayer {
  readonly key: string;
  readonly picture: SkPicture;
  /** The ids of the leaving beads its letters follow. */
  readonly ids: readonly number[];
}

/**
 * Letters returning together: their picture, at the opacity the beads they follow leave them, derived on the UI thread
 * from those beads' looks in the frame the driver writes them (lettersOpacity). It is mounted only while they return,
 * and with no look yet for a bead it is at 0, where the letters were: out. The picture is drawn in a layer whose paint
 * carries that opacity (UI-320: at every head before, the opacity sat on the Group, where a Picture ignores it, so the
 * letters were back whole in one frame).
 */
function Returning({ picture, ids, looks }: { readonly picture: SkPicture; readonly ids: readonly number[]; readonly looks: RimLooksValue }) {
  const opacity = useDerivedValue(() => lettersOpacity(ids, looks.value), [ids, looks]);
  // In a layer of its own: Skia draws a Picture with no paint, so a Group's opacity never reaches it; the layer's does.
  return (
    <Group layer={<Paint opacity={opacity} />}>
      <Picture picture={picture} />
    </Group>
  );
}

interface WordCanvasProps {
  readonly position: RimPosition;
  readonly kept: SkPicture;
  readonly returning: readonly ReturningLayer[];
  readonly looks: RimLooksValue;
}

/**
 * One word's drawing. Memoised on what it draws: its pictures (made once per layout) and the looks' shared value, so a
 * render of the page with nothing new for this word never commits its canvas.
 */
const WordCanvas = memo(function WordCanvasView({ position, kept, returning, looks }: WordCanvasProps) {
  return (
    <Canvas testID={`hero.plate.word.${position}`} style={styles.fill} colorSpace="srgb" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Picture picture={kept} />
      {returning.map((r) => (
        <Returning key={r.key} picture={r.picture} ids={r.ids} looks={looks} />
      ))}
    </Canvas>
  );
});

export function RimLabels({ diameter, fontScale, words: givenWords, a11y, script, beads: givenBeads, looks, fontMgr: givenMgr }: RimLabelsProps) {
  const tokens = useTokens();
  const provided = useTypefaceFontMgr();
  const fontMgr = givenMgr ?? provided;
  const words = useByValue(givenWords, sameWords);
  const beads = useByValue(givenBeads, sameBeads);
  const band = tokens.base.plate.labelBand;
  const label = tokens.base.type.ui.label[script];
  const size = label.size * (Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1);
  const font = useMemo(
    () => matchFont({ fontFamily: tokens.base.type.face.ui, fontSize: size, fontWeight: String(label.weight) as FontWeight }, fontMgr),
    [tokens, size, label.weight, fontMgr],
  );
  useEffect(() => () => font.dispose(), [font]);

  const geometry = useMemo(() => plateGeometry(tokens, diameter, fontScale), [tokens, diameter, fontScale]);
  const laid = useMemo(() => {
    const { ascent, descent } = font.getMetrics();
    const tracking = (script === 'hebrew' ? band.trackingBottomHebrew : band.trackingBottomLatin) * size;
    // The band's padding around its text, grown with the band: room for ink past a letter's cell.
    const pad = (band.padding / 2) * (geometry.band / band.min);
    return RIM_POSITIONS.map((position) => {
      const ids = font.getGlyphIDs(visualOrder(words[position]));
      const layout = layRimWord({
        position,
        advances: font.getGlyphWidths(ids),
        font: { size, ascent, descent },
        tracking: position === 'bottom' ? tracking : 0,
        geometry,
        beads,
        knockoutGap: band.knockoutGap,
        pad,
      });
      return { position, ids, layout };
    });
  }, [geometry, font, script, band, size, words, beads]);

  const ink = tokens.color.text.primary.hex;
  const pictures = useMemo(
    () =>
      laid.map((w) => ({
        kept: recordRimGlyphs(SKIA, w.layout.bounds, w.layout.glyphs.filter((g) => g.state === 'kept'), w.ids, font, ink),
        returning: returningGroups(w.layout).map((group): ReturningLayer => ({
          key: followKey(group.follows, beads),
          ids: group.follows.map((k) => beads[k].id),
          picture: recordRimGlyphs(SKIA, w.layout.bounds, group.glyphs, w.ids, font, ink),
        })),
      })),
    [laid, beads, font, ink],
  );
  useEffect(
    () => () =>
      pictures.forEach((p) => {
        p.kept.dispose();
        for (const r of p.returning) r.picture.dispose();
      }),
    [pictures],
  );

  const root = plateSlot(tokens, geometry, 'words');
  return (
    <View testID="plate.slot.words" collapsable={false} style={[styles.root, root]} pointerEvents="none">
      {RIM_READING_ORDER.map((position) => {
        const i = RIM_POSITIONS.indexOf(position);
        const b = laid[i].layout.bounds;
        const slot = rimWordSlot(tokens, geometry, position);
        // The word's box in plate-local dp, from its slot's origin (the words slot at root, the word slot at slot).
        const left = b.x - root.left - slot.left;
        const top = b.y - root.top - slot.top;
        return (
          <View key={position} testID={`plate.slot.word.${position}`} collapsable={false} pointerEvents="none" style={[styles.slot, slot]}>
            <View
              testID={`hero.plate.word.${position}.a11y`}
              accessible
              accessibilityRole="text"
              accessibilityLabel={a11y[position]}
              style={[styles.word, { left, top, width: b.width, height: b.height }]}
            >
              <WordCanvas position={position} kept={pictures[i].kept} returning={pictures[i].returning} looks={looks} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', direction: 'ltr' },
  slot: { position: 'absolute' },
  word: { position: 'absolute' },
  fill: { flex: 1 },
});
