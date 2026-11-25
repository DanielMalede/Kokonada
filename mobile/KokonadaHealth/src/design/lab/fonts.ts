// The Design Lab's faces, and the check READY waits for before it says the fonts are ready (UI-072, UI-069).
//
// The faces are the v2 fonts the type tokens name (BASE.type.face: Heebo for UI text, Bellefair for the voice; LEDGER
// §5.4), one family per weight, named for its file. React Native on Android loads fonts/<family>.ttf from the APK's
// assets and picks a file by normal or bold only (ReactFontManager.createAssetTypeface), so a weight is a family of its
// own: Heebo-Medium, never Heebo at fontWeight 500. An upstream static cut's file name is also its PostScript name, the
// name iOS looks a font up by.
//
// The check. React Native has no font-loading event on Android: a family resolves when its text is first laid out, and a
// family it cannot find is drawn in the default face without a word. So the lab measures what React Native drew. Beside
// a scene that declares faces it lays out one hidden calibration line per face, and one in a family that cannot exist
// (the fallback, which React Native draws in its default face), all at one origin and one size (FontProbes.tsx). A face
// whose line drew within FACE_MIN_DIFF_DP of the fallback's is the fallback: the font is not in the APK.

import { BASE } from '../v2/tokens/tokens.generated';
import { SETTING_READ_DEADLINE_MS } from './settingRead';

/** The OpenType style name of each named weight, as upstream static files and PostScript names spell it. */
const STYLE_OF_WEIGHT: Readonly<Record<number, string>> = {
  100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black',
};

/** A face's id: the family without spaces, a hyphen, and the style name of the weight (Heebo-Medium, FrankRuhlLibre-Light). */
export function faceId(family: string, weight: number): string {
  const style = STYLE_OF_WEIGHT[weight];
  if (style === undefined) throw new Error(`${weight} is not a named OpenType weight`);
  return `${family.replace(/\s+/g, '')}-${style}`;
}

export type LabFace = { readonly family: string; readonly weight: number };

const UI = BASE.type.face.ui;
const VOICE = BASE.type.face.voice;

/**
 * The faces a lab scene may draw text in, by the family name React Native looks each one up by: the UI face at every
 * weight the type tokens use (display 300; body, legal and caption 400; title, label and nav 500; cta and the active nav
 * 600) and the voice face at 400 only (CMP-125). fonts.test.ts derives this list from the tokens.
 */
export const LAB_FACES = {
  'Heebo-Light': { family: UI, weight: 300 },
  'Heebo-Regular': { family: UI, weight: 400 },
  'Heebo-Medium': { family: UI, weight: 500 },
  'Heebo-SemiBold': { family: UI, weight: 600 },
  'Bellefair-Regular': { family: VOICE, weight: 400 },
} as const satisfies Readonly<Record<string, LabFace>>;

export type LabFaceId = keyof typeof LAB_FACES;

/** The probe drawn in the fallback face. Never a face id: those always carry a style after a hyphen. */
export const FALLBACK_PROBE = 'fallback';
export type FontProbeId = LabFaceId | typeof FALLBACK_PROBE;

/** A family no font in the APK and no system alias answers to, so React Native draws it in its default face. */
export const MISSING_FACE = 'KokonadaLabNoSuchFace';

/**
 * The calibration line: the Hebrew alphabet, finals included, in code-point order. Only Hebrew tells these faces from the
 * fallback. Heebo's Latin and digits are Roboto's, the Android default: summed from the font files' advances, "Kokonada"
 * differs by 0.07% and the digits by 0.00% at Regular. This line in Heebo differs from Noto Sans Hebrew, the Hebrew
 * fallback, by 1.1% at Light to 7.6% at SemiBold, and in Bellefair by 24%: at the probe's 28 dp, 4.3 dp or more, against
 * FACE_MIN_DIFF_DP. A device whose fallback is another Hebrew face is judged against that face, as it draws it.
 */
export const CALIBRATION_TEXT = String.fromCodePoint(...Array.from({ length: 0x05ea - 0x05d0 + 1 }, (_, i) => 0x05d0 + i));

/**
 * The least width difference, in dp, that is a different face. Layout rounds each edge to the pixel, so two lines in the
 * same face at the same origin measure the same; less than a dp apart is the same face, a dp or more is another.
 */
export const FACE_MIN_DIFF_DP = 1;

/**
 * How long the lab waits for the probes to lay out: the setting-read deadline, for the same reason (settingRead.ts). A
 * probe lays out in the scene's first layout pass, and the ERROR must reach the harness while it still waits for READY.
 */
export const FONT_CHECK_DEADLINE_MS = SETTING_READ_DEADLINE_MS;

export type FontVerdict = { readonly settled: false } | { readonly settled: true; readonly error: string | null };

const PENDING: FontVerdict = { settled: false };

/**
 * The judgement over one scene's faces. `measure` records the width React Native laid a probe out at, and returns the
 * verdict: pending until every face and the fallback have one; then applied (error null) or the faces that fell back,
 * each named with its file. A width that is not finite is an error at once. Once settled, nothing changes it.
 */
export function createFontCheck(faces: readonly LabFaceId[]) {
  const probes: readonly FontProbeId[] = [...faces, FALLBACK_PROBE];
  const widths = new Map<FontProbeId, number>();
  let verdict: FontVerdict = faces.length === 0 ? { settled: true, error: null } : PENDING;

  const judge = (): FontVerdict => {
    if (probes.some((p) => !widths.has(p))) return PENDING;
    const fallback = widths.get(FALLBACK_PROBE) as number;
    const fell = faces.filter((f) => Math.abs((widths.get(f) as number) - fallback) < FACE_MIN_DIFF_DP);
    if (fell.length === 0) return { settled: true, error: null };
    return {
      settled: true,
      error: fell.map((f) => `font "${f}" is not applied: its calibration line drew at ${widths.get(f)} dp, the width of the fallback face, so React Native did not find fonts/${f}.ttf in the APK's assets`).join('; '),
    };
  };

  return {
    measure(probe: FontProbeId, width: number): FontVerdict {
      if (verdict.settled || !probes.includes(probe)) return verdict;
      if (!Number.isFinite(width)) {
        verdict = { settled: true, error: `the font probe "${probe}" reported a width that is not a finite number (${width})` };
        return verdict;
      }
      widths.set(probe, width);
      verdict = judge();
      return verdict;
    },
    verdict: (): FontVerdict => verdict,
    /** The probes with no width yet, in the scene's order, the fallback last. */
    unmeasured: (): FontProbeId[] => probes.filter((p) => !widths.has(p)),
  };
}

export type FontCheck = ReturnType<typeof createFontCheck>;

/** The declared faces that are not lab faces, each once, in the order declared. */
export function unknownFaces(faces: readonly string[]): string[] {
  return [...new Set(faces.filter((f) => !Object.prototype.hasOwnProperty.call(LAB_FACES, f)))];
}
