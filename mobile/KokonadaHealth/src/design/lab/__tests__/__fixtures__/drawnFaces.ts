// The faces a rendered lab tree draws text in, as React Native on Android looks each one up (UI-072, fonts.ts): a family
// alone (a face cut by its file, Heebo-Medium), or a family at a weight, which is a token face (Heebo@600, as the v2
// components style their text). Each once, sorted. Shared by scenes.test.tsx, which holds every scene's declaration to
// what it draws, and the scene tests that lay a scene out first (a scene draws its text only once its view has a size).

import { StyleSheet, Text, type TextStyle } from 'react-native';
import type ReactTestRenderer from 'react-test-renderer';
import { tokenFaceId } from '../../fonts';

export function drawnFaces(root: ReactTestRenderer.ReactTestInstance): string[] {
  const faces = root.findAllByType(Text)
    .map((n) => (StyleSheet.flatten(n.props.style) ?? {}) as TextStyle)
    .filter((s): s is TextStyle & { fontFamily: string } => typeof s.fontFamily === 'string')
    .map((s) => (s.fontWeight === undefined ? s.fontFamily : tokenFaceId(s.fontFamily, Number(s.fontWeight))));
  return [...new Set(faces)].sort();
}
