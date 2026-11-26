// The dev-only field preview (option A of the T12 report): the real FieldView, Abyss, on a real-time clock,
// with the face, the scene (rest, one.joy, three), the tier and taps switched from on-screen controls. It
// is opened from the debug app's dev menu (devRoot.tsx) and is absent from every release bundle
// (scripts/jest/__tests__/devPreviewExcluded.test.ts), so it may hold the token extensions
// (extensionsBoundary.test.ts) for the statics and the hero scenes.
//
// It is FieldView's composition root, so it measures: FieldView mounts only once the view has a size
// (UI-175), and the layout, pxPerDp and font scale are read here, never inside FieldView. The breath is
// FieldView's fixed breath at the clock's time (UI-173: a real-time root has no phaser yet); at the
// preview's constant stress that breath's n never changes.

import React, { useCallback, useMemo, useState } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useRealtimeFieldClock } from '../clock/fieldClock.ts';
import { FieldView } from '../field/FieldView.tsx';
import { staticsFor } from '../field/statics.ts';
import type { Tap } from '../field/placementLedger.ts';
import type { MotionTier } from '../motion/useMotionPolicy.ts';
import { EXTENSIONS } from '../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens/tokens.generated.ts';
import { cycle, PREVIEW_SCENES, PREVIEW_TIERS, previewLayout, sceneTaps, tapOnDisc, withTap, type HeroScenes, type PreviewScene } from './previewModel.ts';

const DIRECTION: DirectionId = 'abyss';
const SCENES = (EXTENSIONS as unknown as { base: { $root: { hero: { scenes: HeroScenes } } } }).base.$root.hero.scenes;
const FACES: readonly Face[] = ['dark', 'light'];

export function FieldPreview({ onClose }: { readonly onClose?: () => void }) {
  const [face, setFace] = useState<Face>('dark');
  const [scene, setScene] = useState<PreviewScene>('rest');
  const [tier, setTier] = useState<MotionTier>('full');
  const [taps, setTaps] = useState<readonly Tap[]>(() => sceneTaps(SCENES, 'rest'));
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const statics = useMemo(() => staticsFor(DIRECTION, EXTENSIONS as never), []);
  const clock = useRealtimeFieldClock(BASE.field.clock.T, true);
  const layout = useMemo(() => (size === null ? null : previewLayout(size.width, size.height, PixelRatio.getFontScale())), [size]);
  const colors = DIRECTIONS[DIRECTION].color[face];

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize(width > 0 && height > 0 ? { width, height } : null);
  }, []);
  const onTap = useCallback((e: GestureResponderEvent) => {
    if (layout === null) return;
    const tap = tapOnDisc({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }, layout);
    setTaps((prev) => withTap(prev, tap));
  }, [layout]);
  const nextScene = () => {
    const s = cycle(PREVIEW_SCENES, scene);
    setScene(s);
    setTaps(sceneTaps(SCENES, s));
  };

  const text = [styles.label, { color: colors.text.primary.hex }];
  const control = (testID: string, title: string, onPress?: () => void) => (
    <Pressable testID={testID} onPress={onPress} style={[styles.control, { backgroundColor: colors.surface1.hex }]}>
      <Text style={text}>{title}</Text>
    </Pressable>
  );

  return (
    <View testID="preview.root" style={[styles.root, { backgroundColor: colors.ground.hex }]} onLayout={onLayout}>
      {layout !== null && (
        <Pressable testID="preview.field" style={StyleSheet.absoluteFill} onPress={onTap}>
          <FieldView
            direction={DIRECTION}
            face={face}
            scene={scene}
            statics={statics}
            taps={taps}
            layout={layout}
            pxPerDp={PixelRatio.get()}
            tier={tier}
            stress={0}
            confidence={1}
            genesis={false}
            clock={clock}
          />
        </Pressable>
      )}
      <View style={styles.controls} pointerEvents="box-none">
        {control('preview.face', `face ${face}`, () => setFace(cycle(FACES, face)))}
        {control('preview.scene', `scene ${scene}`, nextScene)}
        {control('preview.tier', `tier ${tier}`, () => setTier(cycle(PREVIEW_TIERS, tier)))}
        {control('preview.clear', 'clear', () => setTaps(sceneTaps(SCENES, scene)))}
        {control('preview.close', 'close', onClose)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: BASE.spacing['3'],
    padding: BASE.spacing['5'],
  },
  control: { paddingHorizontal: BASE.spacing['4'], paddingVertical: BASE.spacing['3'], borderRadius: BASE.cta.radius },
  label: { fontFamily: BASE.type.face.ui, fontSize: BASE.type.ui.label.latin.size, lineHeight: BASE.type.ui.label.latin.lineHeight },
});
