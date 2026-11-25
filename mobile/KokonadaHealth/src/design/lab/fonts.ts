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
//
// Token faces (F10 G8). The v2 components style their text as the type tokens' family at a token weight (fontFamily
// 'Heebo', fontWeight '600'), not as a face cut by its file. React Native on Android looks that family up as
// fonts/Heebo.ttf (fonts/Heebo_bold.ttf from weight 700), a file the APK does not hold, and draws the default face. A
// scene whose components style text that way declares the token face (Heebo@600), and the check measures its line as it
// is drawn, the family at the weight, against the fallback at the same weight: whatever React Native does with a weight,
// it does to both lines alike. So READY is never sent over the fallback face for that text either.

import { BASE } from '../v2/tokens/tokens.generated';
import { SETTING_READ_DEADLINE_MS } from './settingRead';

// A face's id, the family without spaces, a hyphen and the style name of the weight (Heebo-Medium), is v2's own
// (v2/typeface/faces.ts): the file a v2 text style names is the file the lab checks.
export { faceId } from '../v2/typeface/faces';

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

/**
 * The token faces: the type tokens' family at each weight a lab face is cut at, keyed `<family>@<weight>`, as a v2
 * component styles its text (fontFamily the family, fontWeight the weight). fonts.test.ts holds them to LAB_FACES.
 */
export const TOKEN_FACES = {
  'Heebo@300': { family: UI, weight: 300 },
  'Heebo@400': { family: UI, weight: 400 },
  'Heebo@500': { family: UI, weight: 500 },
  'Heebo@600': { family: UI, weight: 600 },
  'Bellefair@400': { family: VOICE, weight: 400 },
} as const satisfies Readonly<Record<string, LabFace>>;

export type TokenFaceId = keyof typeof TOKEN_FACES;
/** A face a scene may declare: one cut by its file (LAB_FACES), or the type tokens' family at a weight (TOKEN_FACES). */
export type SceneFaceId = LabFaceId | TokenFaceId;

/** A token face's id: the family, an at sign and the weight (Heebo@600). */
export function tokenFaceId(family: string, weight: number): string {
  return `${family}@${weight}`;
}

const isTokenFace = (face: string): face is TokenFaceId => Object.prototype.hasOwnProperty.call(TOKEN_FACES, face);

/**
 * The asset React Native on Android loads a family at a weight from: fonts/<family>.ttf, or fonts/<family>_bold.ttf from
 * weight 700 (ReactFontManager picks a file by normal or bold only).
 */
export function tokenFaceFile(family: string, weight: number): string {
  return `fonts/${family}${weight >= 700 ? '_bold' : ''}.ttf`;
}

/** The asset React Native on Android loads a declared face from: its own file, or a token face's family's. */
export function fontFile(face: SceneFaceId): string {
  return isTokenFace(face) ? tokenFaceFile(TOKEN_FACES[face].family, TOKEN_FACES[face].weight) : `fonts/${face}.ttf`;
}

/** The probe drawn in the fallback face. Never a face id: those always carry a style after a hyphen. */
export const FALLBACK_PROBE = 'fallback';
/** The probe drawn in the fallback face at a weight: a token face at that weight is judged against it. */
export type WeightedFallback = `${typeof FALLBACK_PROBE}@${number}`;
export const fallbackAt = (weight: number): WeightedFallback => `${FALLBACK_PROBE}@${weight}`;
export type FontProbeId = SceneFaceId | typeof FALLBACK_PROBE | WeightedFallback;

/** The fallback a declared face is judged against. */
const fallbackOf = (face: SceneFaceId): FontProbeId => (isTokenFace(face) ? fallbackAt(TOKEN_FACES[face].weight) : FALLBACK_PROBE);

/**
 * The probes a scene's faces need, in order: each face as declared, the fallback when a face is cut by its file, then the
 * fallback at each token face's weight, once each, in the order first declared.
 */
export function fontProbes(faces: readonly SceneFaceId[]): FontProbeId[] {
  const plain: FontProbeId[] = faces.some((f) => !isTokenFace(f)) ? [FALLBACK_PROBE] : [];
  const weighted = [...new Set(faces.filter(isTokenFace).map(fallbackOf))];
  return [...faces, ...plain, ...weighted];
}

/**
 * How a probe's line is styled: a face cut by its file is its family alone; a token face is its family at its weight; a
 * fallback is the missing family, at the weight when it has one.
 */
export function probeStyle(probe: FontProbeId): { readonly fontFamily: string; readonly fontWeight?: string } {
  if (probe === FALLBACK_PROBE) return { fontFamily: MISSING_FACE };
  if (probe.startsWith(`${FALLBACK_PROBE}@`)) return { fontFamily: MISSING_FACE, fontWeight: probe.slice(FALLBACK_PROBE.length + 1) };
  if (isTokenFace(probe)) return { fontFamily: TOKEN_FACES[probe].family, fontWeight: String(TOKEN_FACES[probe].weight) };
  return { fontFamily: probe };
}

/** A probe as an error names it: the fallback, the fallback at a weight, or the face in quotes. */
export function probeName(probe: FontProbeId): string {
  if (probe === FALLBACK_PROBE) return 'the fallback';
  if (probe.startsWith(`${FALLBACK_PROBE}@`)) return `the fallback at ${probe.slice(FALLBACK_PROBE.length + 1)}`;
  return `"${probe}"`;
}

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
 * verdict: pending until every face and its fallback have one; then applied (error null) or the faces that fell back,
 * each named with the file React Native looked for. A face cut by its file is judged against the fallback, a token face
 * against the fallback at its weight. A width that is not finite is an error at once. Once settled, nothing changes it.
 */
export function createFontCheck(faces: readonly SceneFaceId[]) {
  const probes: readonly FontProbeId[] = fontProbes(faces);
  const widths = new Map<FontProbeId, number>();
  let verdict: FontVerdict = faces.length === 0 ? { settled: true, error: null } : PENDING;

  const judge = (): FontVerdict => {
    if (probes.some((p) => !widths.has(p))) return PENDING;
    const fell = faces.filter((f) => Math.abs((widths.get(f) as number) - (widths.get(fallbackOf(f)) as number)) < FACE_MIN_DIFF_DP);
    if (fell.length === 0) return { settled: true, error: null };
    return {
      settled: true,
      error: fell.map((f) => `font "${f}" is not applied: its calibration line drew at ${widths.get(f)} dp, the width of the fallback face, so React Native did not find ${fontFile(f)} in the APK's assets`).join('; '),
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
    /** The probes with no width yet, in the scene's order, the fallbacks last. */
    unmeasured: (): FontProbeId[] => probes.filter((p) => !widths.has(p)),
  };
}

export type FontCheck = ReturnType<typeof createFontCheck>;

/** The declared faces that are neither lab faces nor token faces, each once, in the order declared. */
export function unknownFaces(faces: readonly string[]): string[] {
  return [...new Set(faces.filter((f) => !Object.prototype.hasOwnProperty.call(LAB_FACES, f) && !isTokenFace(f)))];
}
