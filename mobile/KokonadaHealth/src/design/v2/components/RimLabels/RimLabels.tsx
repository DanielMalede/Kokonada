// RimLabels (F10 group A, G8-2a; DEC-036; DSN-027, DSN-028): the four axis words on the plate's ring, drawn over the
// field and under the beads, inside the Plate (its child, in plate-local dp).
//
//   · Each word is drawn on the arc by Skia (arc.ts says where, draw.ts draws it) and doubled as a real accessible text
//     node at the word's own box, which TalkBack reads in the order top, right, bottom, left. The drawing is hidden from
//     accessibility; the nodes carry the page's accessible copy (plate.rim.a11y.*). No string is the component's own: the
//     page resolves both through the copy port (F10 R2).
//   · Type: type.face.ui at ui.label's size and weight, times the OS font scale with no cap (DSN-027), in the face's
//     text.primary. The bottom word takes plate.labelBand's tracking for its script. The font comes from `fontMgr` (F6's
//     typeface provider once Heebo is bundled), else the system's, which falls back to the platform's face until then.
//   · Left to right in every locale (R7, QA-088): the root is `direction: 'ltr'`, and each node is placed by its left and
//     top inside it. A Hebrew word is laid in the order it is seen; the plate itself never mirrors.
//   · The knock-out (DSN-028): letters a bead comes near are not drawn; the node and its copy stay whole.
//   · Static: it redraws only when its words, its beads or its geometry change, with no frame work, so reduced motion is
//     the words as drawn. Every picture and font it makes is freed once replaced, and on unmount (RA-31).

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Picture, Skia, matchFont, type SkFontMgr } from '@shopify/react-native-skia';
import { sameTapValues } from '../../field/fieldDriver.ts';
import { useTokens, type Tokens } from '../../tokens/useTokens.ts';
import { plateGeometry, type PlatePoint } from '../Plate/geometry.ts';
import { RIM_POSITIONS, layRimWord, visualOrder, type RimPosition } from './arc.ts';
import { recordRimWord, type RimWordSkia } from './draw.ts';

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
  /** The beads on the plate, oldest first: letters near one are knocked out. */
  readonly beads: readonly PlatePoint[];
  /** The font manager to find type.face.ui in (F6's typeface provider); the system's when omitted. */
  readonly fontMgr?: SkFontMgr;
}

const SKIA: RimWordSkia = { Skia };

const sameWords = (a: RimWords, b: RimWords) => RIM_POSITIONS.every((p) => a[p] === b[p]);

/** The value last seen, kept while each new one equals it: a page that rebuilds the same beads or words redraws nothing. */
function useByValue<T>(value: T, same: (a: T, b: T) => boolean): T {
  const [held, setHeld] = useState(value);
  if (held !== value && !same(held, value)) {
    setHeld(value);
    return value;
  }
  return held;
}

export function RimLabels({ diameter, fontScale, words: givenWords, a11y, script, beads: givenBeads, fontMgr }: RimLabelsProps) {
  const tokens = useTokens();
  const words = useByValue(givenWords, sameWords);
  const beads = useByValue(givenBeads, sameTapValues);
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
  const pictures = useMemo(() => laid.map((w) => recordRimWord(SKIA, w.layout, w.ids, font, ink)), [laid, font, ink]);
  useEffect(() => () => pictures.forEach((p) => p.dispose()), [pictures]);

  return (
    <View style={styles.root} pointerEvents="none">
      {laid.map((w, i) => {
        const b = w.layout.bounds;
        return (
          <View
            key={w.position}
            testID={`hero.plate.word.${w.position}.a11y`}
            accessible
            accessibilityRole="text"
            accessibilityLabel={a11y[w.position]}
            style={[styles.word, { left: b.x, top: b.y, width: b.width, height: b.height }]}
          >
            <Canvas
              testID={`hero.plate.word.${w.position}`}
              style={styles.fill}
              colorSpace="srgb"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Picture picture={pictures[i]} />
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
