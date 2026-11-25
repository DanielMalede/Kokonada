// The typeface provider's loader (F6): the bundled faces, read and registered by family in one Skia font manager, the
// fontMgr Skia text (RimLabels) is set in.
//
// Why: Skia does not see the fonts React Native loads. matchFont through the system font manager looks the family up
// among the platform's fonts; Android has no Heebo, and the typeface it answers has no glyphs, so every word measures 0
// wide and draws nothing. A TypefaceFontProvider holding the bundled files answers the family instead, and Skia's style
// matching picks the file by the weight asked for (each file reports its own weight class), so matchFont's family and
// weight work as they do in a text style on iOS.
//
// The sources are passed in, never required here: src/design/v2 imports nothing outside itself (isolation.test.ts), and
// the files live in assets/fonts. Whoever mounts the provider hands it one source per bundled face (a Metro asset on the
// device) and how to read one.

import type { SkData, SkTypefaceFontProvider, Skia as SkiaApi } from '@shopify/react-native-skia';
import { BUNDLED_FACES, type BundledFaceId } from './faces.ts';

/** One source per bundled face, by face id: on the device the face's Metro asset, require('…/assets/fonts/<id>.ttf'). */
export type FaceSources<S> = Readonly<Record<BundledFaceId, S>>;

/** Reads a face's source into bytes Skia can make a typeface from. */
export type ReadFace<S> = (source: S) => Promise<SkData>;

/** The part of Skia the provider is built with. */
export interface TypefaceSkia {
  readonly Skia: typeof SkiaApi;
}

const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/**
 * A font manager holding every bundled face, registered under its family: Heebo at 300, 400, 500 and 600, Bellefair at
 * 400. Rejects, naming the face, on a face with no source, a source for no bundled face, a read that fails or bytes that
 * are not a font. Each read is freed once its typeface is made, and each typeface once registered: the manager holds its
 * own reference. The caller owns the manager and disposes it.
 */
export async function loadTypefaces<S>(s: TypefaceSkia, sources: FaceSources<S>, read: ReadFace<S>): Promise<SkTypefaceFontProvider> {
  const missing = BUNDLED_FACES.filter((f) => !own(sources, f.id));
  if (missing.length > 0) throw new Error(`no source for the bundled face ${missing.map((f) => f.id).join(', ')}`);
  const extra = Object.keys(sources).filter((id) => !BUNDLED_FACES.some((f) => f.id === id));
  if (extra.length > 0) throw new Error(`a source for ${extra.join(', ')}, which is not a bundled face`);

  const data = await Promise.all(BUNDLED_FACES.map((f) => read(sources[f.id])));
  const provider = s.Skia.TypefaceFontProvider.Make();
  try {
    BUNDLED_FACES.forEach((face, i) => {
      const typeface = s.Skia.Typeface.MakeFreeTypeFaceFromData(data[i]);
      if (typeface === null) throw new Error(`${face.id} (${String(sources[face.id])}) is not a font Skia can read`);
      provider.registerFont(typeface, face.family);
      typeface.dispose();
    });
  } catch (error) {
    provider.dispose();
    throw error;
  } finally {
    for (const d of data) d.dispose();
  }
  return provider;
}
