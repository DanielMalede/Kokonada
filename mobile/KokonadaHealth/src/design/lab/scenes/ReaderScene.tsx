// The reader scene (LF3; P1 spec §B): the F10 LegalReader on the lab's sample document, ids
// `parts.abyss.<face>.reader.<script>` (sceneGroups/parts.ts), filling the stage as the modal fills the screen.
//
//   · The sample, never the policy (P1 spec §B.1 item 2, P1-D10): the SAMPLE marker above the meta block, ink only (a
//     line.control keyline, ui.legal in text.secondary, no fill and no tint), and the reserved example address on the
//     current-text line (parts/sampleLegalDoc.ts). The lab reads nothing under src/legal/.
//   · Close is counted beside the marker, and the reader stays: there is no route here to pop. Nothing opens a URL.
//   · The tier is the app's motion policy on the device's settings (usePolicyTier), so the hairline fades at the full and
//     low tiers and is instant at the still tier. The top inset is the status bar's; the bottom inset is 0 here, since the
//     lab has no safe-area reader (the route passes the real insets, P1 spec §B.3 reader.edge36).

import React, { useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { LegalReader } from '../../v2/components/LegalReader/LegalReader';
import { DirectionProvider } from '../../v2/tokens/DirectionProvider';
import { BASE, DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { fontFace } from '../../v2/typeface/faces';
import type { LabFaceId } from '../fonts';
import { partsScene } from '../parts/partsIds';
import { SAMPLE_ADDRESS, SAMPLE_LEGAL_DOC, SAMPLE_LINES, SAMPLE_MARKER } from '../parts/sampleLegalDoc';
import { Probe } from '../probe/Probe';
import type { LabParams } from '../params';
import { usePolicyTier } from './FieldScene';

/** ui.body and ui.legal are Heebo at 400; ui.title, the title and the headings, at 500. */
export const READER_SCENE_FONTS: readonly LabFaceId[] = ['Heebo-Medium', 'Heebo-Regular'];

const CLOSE: Readonly<Record<'latin' | 'hebrew', string>> = { latin: 'Close', hebrew: 'סגירה' };

export function ReaderScene({ params }: { readonly params: LabParams }) {
  const { face, script } = partsScene(params.scene, 'reader');
  const { tier } = usePolicyTier(params.scene);
  const colour = DIRECTIONS.abyss.color[face];
  const [closes, setCloses] = useState(0);
  const legal = BASE.type.ui.legal[script];
  const tagType = { ...fontFace(BASE.type.face.ui, legal.weight), fontSize: legal.size, lineHeight: legal.lineHeight, color: colour.text.secondary.hex, textAlign: 'left' as const };
  const marker = (
    <View
      testID="reader.marker.box"
      style={[styles.tag, { borderColor: colour.line.control.hex, borderWidth: BASE.icon.stroke, borderRadius: DIRECTIONS.abyss.radius.xs, paddingHorizontal: BASE.spacing['4'], paddingVertical: BASE.spacing['3'] }]}
    >
      <Text testID="reader.marker" style={tagType}>
        {SAMPLE_MARKER[script]}
      </Text>
      <Text testID="reader.closes" style={tagType}>
        {String(closes)}
      </Text>
    </View>
  );
  return (
    <Probe id="stage" style={[styles.stage, { backgroundColor: colour.ground.hex }]}>
      <DirectionProvider direction="abyss" face={face}>
        <LegalReader
          document={SAMPLE_LEGAL_DOC[script]}
          script={script}
          address={SAMPLE_ADDRESS}
          lines={SAMPLE_LINES[script]}
          closeLabel={CLOSE[script]}
          onClose={() => setCloses((n) => n + 1)}
          tier={tier}
          insets={{ top: StatusBar.currentHeight ?? BASE.spacing['0'], bottom: BASE.spacing['0'] }}
          marker={marker}
        />
      </DirectionProvider>
    </Probe>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  tag: { alignSelf: 'stretch' },
});
