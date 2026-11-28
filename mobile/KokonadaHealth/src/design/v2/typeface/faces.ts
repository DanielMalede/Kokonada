// The v2 faces as React Native draws them (F6; UI-069, UI-072). One source of truth for the font a v2 text style names:
// the Design Lab's font check reads its face ids from here.
//
// The app bundles each face as its upstream static file, one file per weight, named for the family without spaces and
// the weight's OpenType style name (Heebo-SemiBold), which is also its PostScript name. React Native on Android loads
// fonts/<fontFamily>.ttf from the APK's assets by that exact name, and picks a file by normal or bold only
// (ReactFontManager): a fontFamily of the tokens' family ('Heebo') with a fontWeight finds no file and draws in the system
// face, so the text loses both the face and its weight. On Android a face is therefore its file's name, with no
// fontWeight: the file already is the weight, and a weight on top would ask for a synthetic one.
//
// iOS is frozen (no Mac): there a face keeps the family and the weight, which iOS matches among the files registered for
// the family. That form is untested on a device.

import { Platform } from 'react-native';

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

/** A face the app bundles: its file (assets/fonts/<id>.ttf), and the family and weight it cuts. */
export interface BundledFace {
  readonly id: string;
  readonly family: string;
  readonly weight: number;
}

/** The faces in assets/fonts: Heebo for UI text at every weight the type tokens use, Bellefair for the voice at 400. */
export const BUNDLED_FACES = [
  { id: 'Heebo-Light', family: 'Heebo', weight: 300 },
  { id: 'Heebo-Regular', family: 'Heebo', weight: 400 },
  { id: 'Heebo-Medium', family: 'Heebo', weight: 500 },
  { id: 'Heebo-SemiBold', family: 'Heebo', weight: 600 },
  { id: 'Bellefair-Regular', family: 'Bellefair', weight: 400 },
] as const satisfies readonly BundledFace[];

export type BundledFaceId = (typeof BUNDLED_FACES)[number]['id'];

type Weight = '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

/** The part of a text style that names its face. */
export interface FontFaceStyle {
  readonly fontFamily: string;
  readonly fontWeight?: Weight;
}

/**
 * The style that draws `family` at `weight` on `os` (React Native's, when none is given): on Android, the bundled file's
 * name and no weight; on iOS, the family and the weight. Throws when no bundled file cuts the family at that weight: text
 * in a face the app does not hold would be drawn in the system face without a word.
 */
export function fontFace(family: string, weight: number, os: string = Platform.OS): FontFaceStyle {
  const face = BUNDLED_FACES.find((f) => f.family === family && f.weight === weight);
  if (face === undefined) throw new Error(`no bundled font file draws ${family} at ${weight}`);
  return os === 'ios' ? { fontFamily: family, fontWeight: String(weight) as Weight } : { fontFamily: face.id };
}
