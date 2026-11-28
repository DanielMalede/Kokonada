// The Well hint scene (LF3; DEC-195 FY-4): the Well as P1·AGE hosts it (host 'button', hintAlign 'start'), showing its hint,
// with the hint's accessibility label, ids `parts.abyss.<face>.well.<script>` (sceneGroups/parts.ts). A capture's TalkBack
// dump reads the label in place of the hint's words; the screen shows the words.
//
//   · Synthetic: the hint, its label and the button's label are the lab's own words, never a catalog's.
//   · The Button is the Well's hosted action, held back while the hint shows (it is drawn at opacity 0 and cannot be
//     reached), as on the age page before the date is valid and the box ticked.
//   · One column, the same inset on both sides: the Well mirrors with the page, and the stage lands the same under RTL.

import React from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Well } from '../../v2/components/Well/Well';
import { DirectionProvider } from '../../v2/tokens/DirectionProvider';
import { BASE, DIRECTIONS } from '../../v2/tokens/tokens.generated';
import { fontFace } from '../../v2/typeface/faces';
import type { LabFaceId } from '../fonts';
import { partsScene, type PartsScript } from '../parts/partsIds';
import { Probe } from '../probe/Probe';
import type { LabParams } from '../params';
import { usePolicyTier } from './FieldScene';

/** The hint is ui.body (Heebo at 400); the hosted button's label ui.cta (600). */
export const WELL_SCENE_FONTS: readonly LabFaceId[] = ['Heebo-Regular', 'Heebo-SemiBold'];

const HINT: Readonly<Record<PartsScript, string>> = {
  latin: 'Fill in both fields to continue.',
  hebrew: 'מלאו את שני השדות כדי להמשיך.',
};
/** What TalkBack reads for the hint: the lab's sample of the label a page passes. */
export const WELL_HINT_LABEL: Readonly<Record<PartsScript, string>> = {
  latin: 'Continue appears once both fields are filled in.',
  hebrew: 'הכפתור המשך יופיע אחרי ששני השדות ימולאו.',
};
const CONTINUE: Readonly<Record<PartsScript, string>> = { latin: 'Continue', hebrew: 'המשך' };

export function WellHintScene({ params }: { readonly params: LabParams }) {
  const { face, script } = partsScene(params.scene, 'well');
  const { tier } = usePolicyTier(params.scene);
  const direction = DIRECTIONS.abyss;
  const colour = direction.color[face];
  const cta = BASE.type.ui.cta[script];
  const inset = { paddingTop: (StatusBar.currentHeight ?? BASE.spacing['0']) + BASE.spacing['7'], paddingHorizontal: direction.layout.gutter };
  return (
    <Probe id="stage" style={[styles.stage, { backgroundColor: colour.ground.hex }]}>
      <DirectionProvider direction="abyss" face={face}>
        <View testID="well-scene.column" style={inset}>
          <Well actionShown={false} hint={HINT[script]} hintAccessibilityLabel={WELL_HINT_LABEL[script]} script={script} tier={tier} host="button" hintAlign="start">
            <Pressable
              testID="well-scene.button"
              accessibilityRole="button"
              onPress={() => undefined}
              style={[styles.button, { minHeight: BASE.cta.height, borderRadius: BASE.cta.radius, backgroundColor: colour.text.primary.hex }]}
            >
              <Text style={{ ...fontFace(BASE.type.face.ui, cta.weight), fontSize: cta.size, lineHeight: cta.lineHeight, color: colour.text.onInk.hex }}>{CONTINUE[script]}</Text>
            </Pressable>
          </Well>
        </View>
      </DirectionProvider>
    </Probe>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  button: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
});
