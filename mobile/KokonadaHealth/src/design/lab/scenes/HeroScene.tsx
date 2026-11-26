// The hero scene (F10 G8-2a and G8-2b): the v2 hero's instrument over the field, composed as the page will compose it, from
// synthetic data only. Ids `hero.abyss.<face>.<taps>.<script>` (sceneGroups/hero.ts). The real FieldView draws the field
// at T13's hero layout (heroLayout, as the field scenes draw it); over it, at the field's own centre and radius, the Plate
// holds its layers in the designer's order (ruling 9): PlateEntry, the list's button; RimLabels; BeadLayer; PlateTouch.
// Under it, at the layout's CTA column, the Well holds the hint and CommitCTA, driven by useCtaMachine.
//
//   · Synthetic: the taps are the token extensions' hero scene `three` or none (`empty`); the words and the accessible
//     copy are the lab's own, in the script the id names. The hint and the label are keyed copy (onboarding.plate.hint,
//     onboarding.continue, N keys of the B1 specs): in Latin through the copy port (useCopy under the scene's
//     CopyProvider); the port resolves in en alone until Hebrew joins it at the cutover (D4-B), so the Hebrew scene reads
//     the same keys from the lab's he table.
//   · Every callback only updates the scene's state: a placement joins the taps (a ring of three, the oldest replaced, as
//     the cold lane's), a removal takes the latest, and a commit, a haptic, the list's button and its focus are counted;
//     nothing leaves the scene.
//   · Wired as a page wires them: one bead presence (useBeadPresence, ruling 2) for the beads BeadLayer draws and the
//     letters RimLabels knocks out and lets return on the bead model's clock (beadOpacityAt); PlateTouch hands focus back
//     to PlateEntry through its handle; the CTA's machine hears the tap count (store) and is bound as FieldView's onStart
//     (F8), which carries each admitted start's live placements.
//   · The tier is the app's motion policy on the device's settings, as a policy scene's (FieldScene.tsx usePolicyTier):
//     READY waits until it is known and says it.
//   · Where it draws: the plate's box sits in a full-stage box laid out left to right, so the plate lands on the field's
//     ring in every locale and never mirrors (R7, QA-088); the Well sits centred on the CTA's column, the same inset on
//     both sides, and mirrors with the page, as the Well does.
//   · It says which surface drew it (UI-223), as a field scene does (useFieldSceneReport): pending until FieldView's first
//     drawn frame of this scene, then ready, or fallback with the reason.
//   · Its fonts: the hint and the label are set in their faces' own files through fontFace (F6), which on Android are
//     Heebo-Regular (ui.body) and Heebo-SemiBold (ui.cta): the scene declares them, and READY waits until each drew in its
//     own face (fonts.ts). The rim words are Skia text: the scene asks for the typeface provider (`typefaces`), and READY
//     waits for its font manager too (LabRoot).

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { Canvas, Circle } from '@shopify/react-native-skia';
import { screenToCircumplex } from '../../../experience/wheel/wheelGeometry';
import { BeadLayer } from '../../v2/components/Bead/BeadLayer';
import { beadOpacityAt } from '../../v2/components/Bead/beadTimeline';
import { useBeadPresence } from '../../v2/components/Bead/useBeadPresence';
import { CommitCTA, useCtaMachine } from '../../v2/components/CommitCTA/CommitCTA';
import { createCopyPort, type Catalog, type CopySpec, type NeutralKeyOf } from '../../v2/copy/CopyPort';
import { CopyProvider, useCopy } from '../../v2/copy/useCopy';
import { plateGeometry, type PlateGeometry, type PlatePoint } from '../../v2/components/Plate/geometry';
import { Plate } from '../../v2/components/Plate/Plate';
import { PlateEntry, type PlateEntryHandle } from '../../v2/components/PlateTouch/PlateEntry';
import { PlateTouch, type PlateHaptics } from '../../v2/components/PlateTouch/PlateTouch';
import { RimLabels, type RimWords } from '../../v2/components/RimLabels/RimLabels';
import { Well } from '../../v2/components/Well/Well';
import { FieldFallbackReport } from '../../v2/field/fallbackReport';
import { heroLayout } from '../../v2/field/fallbackScenes';
import { QUIET_ZONE } from '../../v2/field/fieldLaw';
import { FieldView } from '../../v2/field/FieldView';
import { FieldFirstFrameReport } from '../../v2/field/firstFrameReport';
import type { FieldClock } from '../../v2/clock/fieldClock';
import type { MotionTier } from '../../v2/motion/useMotionPolicy';
import { DirectionProvider } from '../../v2/tokens/DirectionProvider';
import { BASE, DIRECTIONS, type Face } from '../../v2/tokens/tokens.generated';
import { useTokens } from '../../v2/tokens/useTokens';
import { fontFace } from '../../v2/typeface/faces';
import { FIELD_DIRECTION, FIELD_FACES, FIELD_STATICS, heroTaps } from '../fieldScenes';
import type { LabFaceId } from '../fonts';
import { Probe } from '../probe/Probe';
import type { SceneProps } from '../scenes';
import { useFieldSceneReport, usePolicyTier } from './FieldScene';
import { useMeasuredView } from './useMeasuredView';

export const HERO_SCENE_PROBES: readonly string[] = ['stage', 'plate'];
/** How many taps the plate holds: the cold lane's ring (a placement on a full plate replaces the oldest). */
export const HERO_RING = 3;
/**
 * The taps a hero scene starts with: the token extensions' hero scene `three`, or none; and for G8 round 2's evidence,
 * `knock` (HERO_KNOCK_TAPS) and `seam` (the token scene `seam`, its intense bead placed last).
 */
export const HERO_TAPS = ['three', 'empty', 'knock', 'seam'] as const;
/**
 * The knock-out scene's taps (G8 round 2): a bead on the top word's anchor, then one on the left word's, each 0.96 of the
 * way to the rim, where its centre sits on the ring's centre line, well within the bead radius + knockoutGap of the
 * letters of More energy / יותר אנרגיה and of Unpleasant / לא נעים. The left one is the latest.
 */
export const HERO_KNOCK_TAPS: readonly PlatePoint[] = [{ x: 0, y: 0.96 }, { x: -0.96, y: 0 }];
/** The lab-only dial a hero id may end in: `.outline` draws the label band's inner and outer edges at 1 px. */
export const HERO_OUTLINE = 'outline';
/** The script its words, hint and label are in. */
export const HERO_SCRIPTS = ['latin', 'hebrew'] as const;
export type HeroTaps = (typeof HERO_TAPS)[number];
export type HeroScript = (typeof HERO_SCRIPTS)[number];

export const heroSceneId = (face: Face, taps: HeroTaps, script: HeroScript, outline = false) =>
  `hero.${FIELD_DIRECTION}.${face}.${taps}.${script}${outline ? `.${HERO_OUTLINE}` : ''}`;

/** A hero scene's face, taps, script and dial, from its id: an id that is not a hero scene is a programming error. */
export function heroScene(id: string): { readonly face: Face; readonly taps: HeroTaps; readonly script: HeroScript; readonly outline: boolean } {
  for (const face of FIELD_FACES) {
    for (const taps of HERO_TAPS) {
      for (const script of HERO_SCRIPTS) {
        for (const outline of [false, true]) if (heroSceneId(face, taps, script, outline) === id) return { face, taps, script, outline };
      }
    }
  }
  throw new Error(`"${id}" is not a lab hero scene`);
}

/**
 * The faces the hero's components set their text in on Android, the lab's platform: through fontFace, the bundled file of
 * ui.body's weight (the Well's hint) and of ui.cta's (the CTA's label), in either script, each once.
 */
export const HERO_FONTS: readonly LabFaceId[] = [...new Set(HERO_SCRIPTS.flatMap((s) => [
  fontFace(BASE.type.face.ui, BASE.type.ui.body[s].weight, 'android').fontFamily,
  fontFace(BASE.type.face.ui, BASE.type.ui.cta[s].weight, 'android').fontFamily,
]))] as LabFaceId[];

/** The keyed copy the hero draws: the Well's hint and the CTA's label, two N keys (B1 specs, rev. designer 2026-11-24). */
export const HERO_COPY_SPEC = {
  'onboarding.plate.hint': { class: 'N' },
  'onboarding.continue': { class: 'N' },
} as const satisfies CopySpec;
type HeroKey = NeutralKeyOf<typeof HERO_COPY_SPEC>;

/** Their en text, as the port reads it. */
export const HERO_CATALOGS = {
  en: { 'onboarding.plate.hint': 'Tap the plate to place a point.', 'onboarding.continue': 'Continue' } satisfies Record<HeroKey, string>,
} as const satisfies { readonly en: Catalog };

/** Their he text, by the same keys: the port has no he locale until the cutover (D4-B), so the Hebrew scene reads it here. */
export const HERO_HE_CATALOG: Readonly<Record<HeroKey, string>> = {
  'onboarding.plate.hint': 'אפשר לגעת בלוח כדי לסמן נקודה.',
  'onboarding.continue': 'המשך',
};

/** One port, built once (a new port re-renders every reader). */
const HERO_PORT = createCopyPort({ spec: HERO_COPY_SPEC, catalogs: HERO_CATALOGS });

/** The lab's synthetic copy, by script (the keyed hint and label are not in it). */
export interface HeroCopy {
  readonly words: RimWords;
  readonly a11y: RimWords;
  /** PlateEntry's label and hint (plate.a11y.label and plate.a11y.hint): the list's button. */
  readonly plateLabel: string;
  readonly plateHint: string;
  readonly latestLabel: string;
  readonly removeLabel: string;
}

export const HERO_COPY: Readonly<Record<HeroScript, HeroCopy>> = {
  latin: {
    words: { top: 'More energy', right: 'Pleasant', bottom: 'Less energy', left: 'Unpleasant' },
    a11y: { top: 'Top: more energy', right: 'Right: pleasant', bottom: 'Bottom: less energy', left: 'Left: unpleasant' },
    plateLabel: 'Plate',
    plateHint: 'Holds up to three points. Double-tap to open a list of every place.',
    latestLabel: 'Latest point',
    removeLabel: 'Remove',
  },
  hebrew: {
    words: { top: 'יותר אנרגיה', right: 'נעים', bottom: 'פחות אנרגיה', left: 'לא נעים' },
    a11y: { top: 'למעלה: יותר אנרגיה', right: 'ימין: נעים', bottom: 'למטה: פחות אנרגיה', left: 'שמאל: לא נעים' },
    plateLabel: 'לוח',
    plateHint: 'אפשר להניח עד שלוש נקודות. הקישו פעמיים כדי לפתוח רשימה של כל המקומות.',
    latestLabel: 'הנקודה האחרונה',
    removeLabel: 'הסרה',
  },
};

/** The scene's state: its taps (oldest first), and what the commit, haptic, list and focus callbacks counted. */
export interface HeroState {
  readonly taps: readonly PlatePoint[];
  readonly commits: number;
  readonly haptics: number;
  readonly lists: number;
  readonly entryFocused: boolean;
}

/** A scene's starting taps, oldest first. */
function startingTaps(taps: HeroTaps): readonly PlatePoint[] {
  switch (taps) {
    case 'three': return heroTaps('three');
    case 'knock': return HERO_KNOCK_TAPS;
    // The seam's beads by x, right first: the intense one, left of 12 o'clock, is placed last, so Remove takes it.
    case 'seam': return [...heroTaps('seam')].sort((a, b) => b.x - a.x);
    case 'empty': return [];
  }
}

export function heroInitial(taps: HeroTaps): HeroState {
  return { taps: startingTaps(taps), commits: 0, haptics: 0, lists: 0, entryFocused: false };
}

/** A placement: it joins the taps, and on a full plate the oldest goes. */
export function heroPlaced(s: HeroState, point: PlatePoint): HeroState {
  return { ...s, taps: [...s.taps, point].slice(Math.max(0, s.taps.length + 1 - HERO_RING)) };
}

/** The latest tap removed; with none, nothing changes. */
export function heroRemoved(s: HeroState): HeroState {
  return s.taps.length === 0 ? s : { ...s, taps: s.taps.slice(0, -1) };
}

export function HeroScene({ clock, params }: SceneProps) {
  const { face, taps, script, outline } = heroScene(params.scene);
  const { tier, observed, unreadable } = usePolicyTier(params.scene);
  const { onFirstFrame, setFellBack } = useFieldSceneReport(params.scene, observed, unreadable);
  const { size, onLayout } = useMeasuredView();
  return (
    <FieldFallbackReport.Provider value={setFellBack}>
      <Probe id="stage" style={styles.stage}>
        <View testID="hero-scene.view" style={styles.stage} onLayout={onLayout}>
          <DirectionProvider direction={FIELD_DIRECTION} face={face}>
            <CopyProvider port={HERO_PORT}>
              {size === null ? <Probe id="plate" style={UNPLACED} /> : (
                <FieldFirstFrameReport.Provider value={onFirstFrame}>
                  <HeroStage scene={params.scene} face={face} taps={taps} script={script} outline={outline} width={size.width} height={size.height} clock={clock} tier={tier} />
                </FieldFirstFrameReport.Provider>
              )}
            </CopyProvider>
          </DirectionProvider>
        </View>
      </Probe>
    </FieldFallbackReport.Provider>
  );
}

function HeroStage({ scene, face, taps, script, outline, width, height, clock, tier }: {
  scene: string;
  face: Face;
  taps: HeroTaps;
  script: HeroScript;
  outline: boolean;
  width: number;
  height: number;
  clock: FieldClock;
  tier: MotionTier;
}) {
  const tokens = useTokens();
  const copy = HERO_COPY[script];
  const port = useCopy<typeof HERO_COPY_SPEC>();
  const keyed = (key: HeroKey) => (script === 'latin' ? port.text(key) : HERO_HE_CATALOG[key]);
  const layout = useMemo(() => heroLayout(FIELD_DIRECTION, width, height, PixelRatio.getFontScale()), [width, height]);
  const diameter = 2 * layout.radius;
  const plate = useMemo(() => plateGeometry(tokens, diameter, layout.fontScale), [tokens, diameter, layout.fontScale]);

  const [state, setState] = useState(() => heroInitial(taps));
  // The state each callback builds on: the one last set, so two callbacks of one gesture (a haptic, then the placement)
  // each see the other's.
  const latest = useRef(state);

  // DEC-174's machine, owned here as the page owns it: it hears the tap count when it changes, and is FieldView's onStart.
  const paint = useMemo(() => ({ id: tokens.id, face: tokens.face }), [tokens.id, tokens.face]);
  const { machine, store, start } = useCtaMachine(paint, tier, state.taps);
  // The page's one bead presence (ruling 2): BeadLayer draws it, and RimLabels knocks its letters out by it.
  const presence = useBeadPresence(state.taps, tier);
  // The list's button (ruling 9): PlateTouch hands focus back to it when Remove leaves no tap.
  const entry = useRef<PlateEntryHandle>(null);

  const apply = useCallback((next: HeroState) => {
    const was = latest.current;
    latest.current = next;
    setState(next);
    if (next.taps.length !== was.taps.length) store(next.taps.length);
  }, [store]);
  const onPlace = useCallback((point: PlatePoint) => apply(heroPlaced(latest.current, point)), [apply]);
  const onRemoveLatest = useCallback(() => apply(heroRemoved(latest.current)), [apply]);
  const haptics = useMemo<PlateHaptics>(() => ({ fire: () => apply({ ...latest.current, haptics: latest.current.haptics + 1 }) }), [apply]);
  const onCommit = useCallback(() => apply({ ...latest.current, commits: latest.current.commits + 1 }), [apply]);
  const onOpenList = useCallback(() => apply({ ...latest.current, lists: latest.current.lists + 1 }), [apply]);
  const onEntryFocus = useCallback((focused: boolean) => apply({ ...latest.current, entryFocused: focused }), [apply]);

  const column = layout.quietRects?.[QUIET_ZONE.cta];
  const inset = column === undefined ? 0 : column.x;
  const wellTop = layout.centre[1] + layout.radius + DIRECTIONS[FIELD_DIRECTION].layout.gap.plateToWell;
  const actionShown = machine.opacity !== null && machine.opacity.kind === 'show';
  const box = { left: layout.centre[0] - layout.radius, top: layout.centre[1] - layout.radius, width: diameter, height: diameter };

  return (
    <>
      <FieldView
        direction={FIELD_DIRECTION}
        face={face}
        scene={scene}
        statics={FIELD_STATICS}
        taps={state.taps}
        layout={layout}
        pxPerDp={PixelRatio.get()}
        tier={tier}
        stress={0}
        confidence={1}
        genesis={false}
        clock={clock}
        onStart={start}
      />
      <View testID="hero-scene.plate-box" style={styles.ltrFill} pointerEvents="box-none">
        <Probe id="plate" style={[styles.plate, box]}>
          <Plate diameter={diameter} fontScale={layout.fontScale}>
            <PlateEntry ref={entry} plate={plate} label={copy.plateLabel} hint={copy.plateHint} onOpenList={onOpenList} onFocusChange={onEntryFocus} inert={false} />
            <RimLabels diameter={diameter} fontScale={layout.fontScale} words={copy.words} a11y={copy.a11y} script={script} beads={presence.beads} beadOpacity={beadOpacityAt} />
            {outline ? <BandOutline plate={plate} /> : null}
            <BeadLayer beads={presence.beads} plate={plate} onGone={presence.onGone} onExitStart={presence.onExitStart} />
            <PlateTouch
              plate={plate}
              taps={state.taps}
              toPoint={screenToCircumplex}
              onPlace={onPlace}
              onRemoveLatest={onRemoveLatest}
              haptics={haptics}
              inert={false}
              entry={entry}
              latestLabel={copy.latestLabel}
              removeLabel={copy.removeLabel}
            />
          </Plate>
        </Probe>
      </View>
      <View testID="hero-scene.well-column" style={[styles.wellColumn, { left: inset, right: inset, top: wellTop }]} pointerEvents="box-none">
        <Well actionShown={actionShown} hint={keyed('onboarding.plate.hint')} script={script} tier={tier}>
          <CommitCTA machine={machine} label={keyed('onboarding.continue')} onCommit={onCommit} tier={tier} />
        </Well>
      </View>
    </>
  );
}

/** The outline dial's ink: a magenta no face and no field paints, so a capture can tell it from the words and the field. */
// eslint-disable-next-line kokonada/no-color-literals -- a lab-only diagnostic stroke that must be no token's colour, so a capture tells it from the words and the field
const OUTLINE_INK = '#FF00FF';

/**
 * The outline dial (G8 round 2, lab only): the label band's inner edge (ringInner) and outer edge (R) as 1 px strokes, over
 * the words and under the beads, so a capture shows whether any letter touches either edge. Hidden from TalkBack and touch.
 */
function BandOutline({ plate }: { plate: PlateGeometry }) {
  const hair = 1 / PixelRatio.get();
  const [cx, cy] = plate.centre;
  return (
    <Canvas
      testID="hero.lab.outline"
      style={[styles.outline, { width: plate.diameter, height: plate.diameter }]}
      colorSpace="srgb"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Circle cx={cx} cy={cy} r={plate.ringInner} style="stroke" strokeWidth={hair} color={OUTLINE_INK} />
      <Circle cx={cx} cy={cy} r={plate.radius} style="stroke" strokeWidth={hair} color={OUTLINE_INK} />
    </Canvas>
  );
}

const UNPLACED = { position: 'absolute' as const, left: 0, top: 0, width: 0, height: 0 };

const styles = StyleSheet.create({
  stage: { flex: 1 },
  // The plate never mirrors: its box is laid out left to right in every locale, over the whole stage.
  ltrFill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, direction: 'ltr', overflow: 'visible' },
  // The touch surface reaches past the plate's box (PlateTouch's margin), so nothing between them clips it.
  plate: { position: 'absolute', overflow: 'visible' },
  wellColumn: { position: 'absolute' },
  outline: { position: 'absolute', left: 0, top: 0 },
});
