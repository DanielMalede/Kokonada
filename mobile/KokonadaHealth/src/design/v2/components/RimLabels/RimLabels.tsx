// RimLabels (F10 group A, G8-2a; DEC-036; DSN-027, DSN-028): the four axis words on the plate's ring, drawn over the
// field and under the beads, inside the Plate (its child, in plate-local dp).
//
//   · Each word is drawn on the arc by Skia (arc.ts says where, draw.ts draws it) and doubled as a real accessible text
//     node at the word's own box. The nodes are mounted in the order TalkBack reads them in every locale, top, bottom,
//     right, left (RIM_READING_ORDER, the designer's ruling 1). The drawing is hidden from accessibility; the nodes
//     carry the page's accessible copy (plate.rim.a11y.*). No string is the component's own: the page resolves both
//     through the copy port (F10 R2).
//   · Type: type.face.ui at ui.label's size and weight, times the OS font scale with no cap (DSN-027), in the face's
//     text.primary. The bottom word takes plate.labelBand's tracking for its script. The font comes from `fontMgr`,
//     else the typeface provider's above the page (F6: the bundled faces), else the system's, which on Android has no
//     Heebo and answers a typeface with no glyphs.
//   · Left to right in every locale (R7, QA-088): the root is `direction: 'ltr'`, and each node is placed by its left and
//     top inside it. A Hebrew word is laid in the order it is seen; the plate itself never mirrors.
//   · The knock-out (DSN-028; the designer's ruling 2): letters near a live bead are not drawn, from the frame it appears.
//     Letters near leaving beads only are drawn in a returning picture of their own, one per set of beads they follow,
//     whose opacity the UI thread sets at every frame from the bead model's exit function (beadOpacity) and each bead's
//     leftAt (returningOpacity). So under reduced motion, where a bead goes in one frame, its letters return in that
//     frame. When the beads are gone the letters are kept, drawn as they were. The node and its copy stay whole.
//   · At rest it is static: it redraws only when its words, its beads or its geometry change, and a frame callback runs
//     only while letters are returning, so no frame work happens while no bead is leaving. Every picture and font it
//     makes is freed once replaced, and on unmount (RA-31).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Group, Picture, Skia, matchFont, type SkFontMgr, type SkPicture } from '@shopify/react-native-skia';
import { useFrameCallback, useSharedValue, type FrameInfo } from 'react-native-reanimated';
import { useTokens, type Tokens } from '../../tokens/useTokens.ts';
import { useTypefaceFontMgr } from '../../typeface/TypefaceProvider.tsx';
import { plateGeometry } from '../Plate/geometry.ts';
import {
  RIM_POSITIONS,
  RIM_READING_ORDER,
  layRimWord,
  returningGroups,
  returningOpacity,
  visualOrder,
  type BeadOpacity,
  type RimBead,
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
   * A bead's opacity at a moment: the bead model's exit function (Bead/ exports it; the page passes it). A worklet: the
   * UI thread calls it at every frame while letters are returning, with that frame's timestamp, the clock each bead's
   * leftAt is stamped on.
   */
  readonly beadOpacity: BeadOpacity;
  /**
   * The font manager to find type.face.ui in. When omitted, the typeface provider's above the page (F6), once its faces
   * are in; else the system's, which on Android has no Heebo and draws no glyph.
   */
  readonly fontMgr?: SkFontMgr;
}

const SKIA: RimWordSkia = { Skia };

const sameWords = (a: RimWords, b: RimWords) => RIM_POSITIONS.every((p) => a[p] === b[p]);

/** Two bead lists by value (RA-39): the same length, and at each place the same point, state, leftAt and start (Object.is). */
const sameBeads = (a: readonly RimBead[], b: readonly RimBead[]) =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      Object.is(x.point.x, b[i].point.x) &&
      Object.is(x.point.y, b[i].point.y) &&
      x.leaving === b[i].leaving &&
      Object.is(x.leftAt, b[i].leftAt) &&
      Object.is(x.startOpacity, b[i].startOpacity),
  );

/**
 * A returning group's key: the places of the beads it follows, never their indices, so its layer, and the opacity the
 * UI thread has set on it, stays while other beads come and go. Beads at one place reach the same letters, so they are
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

interface ReturningProps {
  readonly picture: SkPicture;
  /** The leaving beads its letters follow. */
  readonly beads: readonly RimBead[];
  readonly beadOpacity: BeadOpacity;
}

/**
 * Letters returning together: their picture, at the opacity the beads they follow leave them, set by the UI thread at
 * every frame (returningOpacity). It is mounted only while they return, so its frame callback runs only while an exit
 * does, and it starts at 0, where the letters were: out.
 */
function Returning({ picture, beads, beadOpacity }: ReturningProps) {
  const opacity = useSharedValue(0);
  const onFrame = useCallback(
    (frame: FrameInfo) => {
      'worklet';
      opacity.value = returningOpacity(beads, frame.timestamp, beadOpacity);
    },
    [opacity, beads, beadOpacity],
  );
  useFrameCallback(onFrame);
  return (
    <Group opacity={opacity}>
      <Picture picture={picture} />
    </Group>
  );
}

export function RimLabels({ diameter, fontScale, words: givenWords, a11y, script, beads: givenBeads, beadOpacity, fontMgr: givenMgr }: RimLabelsProps) {
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

  const laid = useMemo(() => {
    const geometry = plateGeometry(tokens, diameter, fontScale);
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
  }, [tokens, diameter, fontScale, font, script, band, size, words, beads]);

  const ink = tokens.color.text.primary.hex;
  const pictures = useMemo(
    () =>
      laid.map((w) => ({
        kept: recordRimGlyphs(SKIA, w.layout.bounds, w.layout.glyphs.filter((g) => g.state === 'kept'), w.ids, font, ink),
        returning: returningGroups(w.layout).map((group) => ({
          key: followKey(group.follows, beads),
          beads: group.follows.map((k) => beads[k]),
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

  return (
    <View style={styles.root} pointerEvents="none">
      {RIM_READING_ORDER.map((position) => {
        const i = RIM_POSITIONS.indexOf(position);
        const b = laid[i].layout.bounds;
        return (
          <View
            key={position}
            testID={`hero.plate.word.${position}.a11y`}
            accessible
            accessibilityRole="text"
            accessibilityLabel={a11y[position]}
            style={[styles.word, { left: b.x, top: b.y, width: b.width, height: b.height }]}
          >
            <Canvas
              testID={`hero.plate.word.${position}`}
              style={styles.fill}
              colorSpace="srgb"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Picture picture={pictures[i].kept} />
              {pictures[i].returning.map((r) => (
                <Returning key={r.key} picture={r.picture} beads={r.beads} beadOpacity={beadOpacity} />
              ))}
            </Canvas>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, direction: 'ltr' },
  word: { position: 'absolute' },
  fill: { flex: 1 },
});
