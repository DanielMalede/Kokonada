// The fonts scene (UI-072, UI-069; F10 G8): every face the lab knows, each named by the file React Native loads it from and
// drawn in itself, ids `fonts.abyss.<face>` (sceneGroups/fonts.ts). It declares all five (LAB_FACES), so READY says each one
// drew in its own face (LabRoot measures each against the fallback, fonts.ts), and a face missing from the APK's assets is
// one ERROR naming it and its file, never a READY over the fallback face. A capture shows the five faces.
//
//   · Each face draws three lines at ui.body's size, so all five fit the screen at font scale 2.0: its id and weight, then
//     the Hebrew alphabet in two halves and the digits, in the face's text.primary on its ground. Synthetic: no copy of
//     the app.
//   · One column: nothing is placed by its sides or its row order, so it mirrors with the locale and its one probe, the
//     stage, lands the same under RTL. The stage paints the ground.

import React from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { BASE, DIRECTIONS, type Face } from '../../v2/tokens/tokens.generated';
import { FIELD_DIRECTION, FIELD_FACES } from '../fieldScenes';
import { LAB_FACES, type LabFaceId } from '../fonts';
import type { LabParams } from '../params';
import { Probe } from '../probe/Probe';

export const FONTS_SCENE_PROBES: readonly string[] = ['stage'];
/** The faces the scene draws and declares: every lab face, in LAB_FACES order. */
export const FONTS_SCENE_FACES = Object.keys(LAB_FACES) as LabFaceId[];

export const fontsSceneId = (face: Face) => `fonts.${FIELD_DIRECTION}.${face}`;

/** The face a fonts scene's id names: an id that is not a fonts scene is a programming error. */
export function fontsFace(id: string): Face {
  const face = FIELD_FACES.find((f) => fontsSceneId(f) === id);
  if (face === undefined) throw new Error(`"${id}" is not a lab fonts scene`);
  return face;
}

/** The Hebrew alphabet without its final forms and the digits, in two halves (each one line at font scale 2.0). */
export const FONTS_SPECIMEN = ['אבגדהוזחטיכ 01234', 'למנסעפצקרשת 56789'] as const;

/** A lab scene's props, of which it reads only the launch's params. */
export function FontsScene({ params }: { readonly params: LabParams }) {
  const face = fontsFace(params.scene);
  const direction = DIRECTIONS[FIELD_DIRECTION];
  const colour = direction.color[face];
  const body = BASE.type.ui.body.hebrew;
  // Below the status bar (the lab window is edge to edge), within the gutter.
  const inset = { paddingTop: (StatusBar.currentHeight ?? BASE.spacing['0']) + BASE.spacing['7'], paddingHorizontal: direction.layout.gutter };
  return (
    <Probe id="stage" style={[styles.stage, { backgroundColor: colour.ground.hex }]}>
      <View testID="fonts-scene.column" style={inset}>
        {FONTS_SCENE_FACES.map((id) => {
          const type = { fontFamily: id, fontSize: body.size, lineHeight: body.lineHeight, color: colour.text.primary.hex };
          return (
            <View key={id} testID={`fonts-scene.${id}`} style={styles.specimen}>
              <Text style={type}>{`${id} ${LAB_FACES[id].weight}`}</Text>
              {FONTS_SPECIMEN.map((line) => <Text key={line} style={type}>{line}</Text>)}
            </View>
          );
        })}
      </View>
    </Probe>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  specimen: { paddingBottom: BASE.spacing['3'] },
});
