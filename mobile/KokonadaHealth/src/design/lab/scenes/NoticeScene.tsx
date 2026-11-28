// The notice scene (LF3; P1 spec §3 and §3.1, build note E): the F10 InlineNotice three times on the ground, ids
// `parts.abyss.<face>.notice.<script>` (sceneGroups/parts.ts): with no action (the sign-in-incomplete line, P11's errors),
// with one (the readings notice's dismiss) and with two (the policy notice's link and dismiss, its body selectable with an
// address in it). At font 2.0, or in a narrow column, the two actions stack, decided from their measured widths.
//
//   · Synthetic: the words are the lab's own, never a catalog's, and the address is a reserved example domain (RFC 2606),
//     never the hosted policy (P1-D10). A press opens nothing: it is counted on the stage, so a capture shows it landed.
//   · One column, the same inset on both sides: the notices mirror with the page, as they do, and the stage, the one
//     probe, lands the same under RTL.

import React, { useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { InlineNotice } from '../../v2/components/InlineNotice/InlineNotice';
import { LRI, PDI } from '../../v2/components/LegalReader/legalDocument';
import { DirectionProvider } from '../../v2/tokens/DirectionProvider';
import { BASE, DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { fontFace } from '../../v2/typeface/faces';
import type { LabFaceId } from '../fonts';
import { partsScene, type PartsScript } from '../parts/partsIds';
import { SAMPLE_ADDRESS } from '../parts/sampleLegalDoc';
import { Probe } from '../probe/Probe';
import type { LabParams } from '../params';

/** The notices and the counter are ui.body and ui.caption, both Heebo at 400. */
export const NOTICE_SCENE_FONTS: readonly LabFaceId[] = ['Heebo-Regular'];

const WORDS: Readonly<Record<PartsScript, { none: string; one: string; two: string; link: string; dismiss: string; hint: string }>> = {
  latin: {
    none: 'A notice with no action. It only tells, and it never takes focus.',
    one: 'A notice with one action, a dismiss at the start of the text.',
    two: `A notice with two actions. Its words can be selected, and the address in them is plain text: ${LRI}${SAMPLE_ADDRESS}${PDI}.`,
    link: 'Open the address',
    dismiss: 'Dismiss',
    hint: 'A sample hint, read after the label',
  },
  hebrew: {
    none: 'הודעה בלי פעולה. היא רק מודיעה, ולעולם אינה לוקחת את המיקוד.',
    one: 'הודעה עם פעולה אחת, סגירה בתחילת הטקסט.',
    two: `הודעה עם שתי פעולות. אפשר לבחור את המילים שלה, והכתובת שבהן היא טקסט רגיל: ${LRI}${SAMPLE_ADDRESS}${PDI}.`,
    link: 'פתיחת הכתובת',
    dismiss: 'סגירה',
    hint: 'רמז לדוגמה, שנקרא אחרי התווית',
  },
};

export function NoticeScene({ params }: { readonly params: LabParams }) {
  const { face, script } = partsScene(params.scene, 'notice');
  const direction = DIRECTIONS.abyss;
  const colour = direction.color[face];
  const words = WORDS[script];
  const [presses, setPresses] = useState(0);
  const press = () => setPresses((n) => n + 1);
  const caption = BASE.type.ui.caption[script];
  const inset = { paddingTop: (StatusBar.currentHeight ?? BASE.spacing['0']) + BASE.spacing['7'], paddingHorizontal: direction.layout.gutter };
  return (
    <Probe id="stage" style={[styles.stage, { backgroundColor: colour.ground.hex }]}>
      <DirectionProvider direction="abyss" face={face}>
        <View testID="notice-scene.column" style={inset}>
          <InlineNotice testID="notice.none" body={words.none} script={script} />
          <View style={styles.gap} />
          <InlineNotice testID="notice.one" body={words.one} script={script} actions={[{ kind: 'button', label: words.dismiss, onPress: press }]} />
          <View style={styles.gap} />
          <InlineNotice
            testID="notice.two"
            body={words.two}
            script={script}
            selectable
            actions={[
              { kind: 'link', label: words.link, onPress: press, accessibilityHint: words.hint },
              { kind: 'button', label: words.dismiss, onPress: press },
            ]}
          />
          <Text
            testID="notice.presses"
            style={{
              ...fontFace(BASE.type.face.ui, caption.weight),
              fontSize: caption.size,
              lineHeight: caption.lineHeight,
              color: colour.text.secondary.hex,
              marginTop: BASE.spacing['5'],
              textAlign: 'left',
            }}
          >
            {String(presses)}
          </Text>
        </View>
      </DirectionProvider>
    </Probe>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  gap: { height: BASE.spacing['5'] },
});
