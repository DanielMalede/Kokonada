// The font probes (UI-072, fonts.ts): for a scene that declares faces, one calibration line per face and one in the
// fallback, each reporting the width React Native laid it out at. LabRoot judges those widths before READY.
//
// They must measure alike and never be seen:
//   · one size, no weight, no font scaling and one line, every line at the same origin, so the only difference between
//     two lines is the face they drew in, and the fallback's pixel rounding is the same as a missing face's;
//   · off the scene's layout (absolute), never drawn (opacity 0: Android does not draw a view under its alpha threshold),
//     hidden from TalkBack and from touch, and never a lab probe (no probe- nativeID), so no capture, bounds dump or READY
//     probe set ever holds them;
//   · in a box wide enough that the line never wraps: the alphabet at 28 dp is at most about 420 dp (Heebo SemiBold).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BASE } from '../v2/tokens/tokens.generated';
import { CALIBRATION_TEXT, FALLBACK_PROBE, MISSING_FACE, type FontProbeId, type LabFaceId } from './fonts';

export const FONT_PROBES_TEST_ID = 'lab-font-probes';
export const fontProbeTestId = (probe: FontProbeId) => `lab-font-probe:${probe}`;

export function FontProbes({ faces, onWidth }: {
  faces: readonly LabFaceId[];
  onWidth(probe: FontProbeId, width: number): void;
}) {
  const probes: readonly FontProbeId[] = [...faces, FALLBACK_PROBE];
  return (
    <View
      testID={FONT_PROBES_TEST_ID}
      style={styles.box}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {probes.map((probe) => (
        <Text
          key={probe}
          testID={fontProbeTestId(probe)}
          allowFontScaling={false}
          numberOfLines={1}
          style={[styles.line, { fontFamily: probe === FALLBACK_PROBE ? MISSING_FACE : probe }]}
          onLayout={(e) => onWidth(probe, e.nativeEvent.layout.width)}
        >
          {CALIBRATION_TEXT}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', left: 0, top: 0, width: 2000, height: 100, opacity: 0 },
  // The scale's largest UI size: the faces' widths differ most at the largest size, and it is a size the scale names.
  line: { position: 'absolute', left: 0, top: 0, fontSize: BASE.type.ui.display.hebrew.size },
});
