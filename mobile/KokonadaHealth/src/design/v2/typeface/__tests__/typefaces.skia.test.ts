/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { Skia, matchFont, type SkData, type SkFont, type SkFontMgr } from '@shopify/react-native-skia';
import { BASE } from '../../tokens/tokens.generated.ts';
import { BUNDLED_FACES, type BundledFaceId } from '../faces.ts';
import { loadTypefaces, type FaceSources } from '../typefaces.ts';

// The typeface provider (F6) in real Skia (CanvasKit). On Android the rim words drew no glyph: matchFont('Heebo') through
// the system font manager found no such family and gave a typeface with no glyphs, so every word measured 0 wide. The
// provider registers the bundled files under their families in a TypefaceFontProvider, the font manager RimLabels takes;
// matchFont then picks the file by the weight asked for, as Skia's own style matching does on the device.
//
// At CanvasKit's own door and nowhere else: RN Skia's web wrapper of a TypefaceFontProvider throws on matchFamilyStyle
// ("not implemented on React Native Web"), where the device's JSI binding asks Skia's provider for the family and matches
// the style (JsiSkTypefaceFontProvider.h: onMatchFamily, then matchStyle, and a throw for a family it does not hold). So
// the wrapper is given the device's behaviour, over CanvasKit's own matchFamilyStyle: the style passes as matchFont builds
// it (numbers), and a family the provider does not hold throws, as on the device.

type CanvasKitProvider = { matchFamilyStyle(name: string, style: unknown): unknown };
const CK = (globalThis as unknown as { CanvasKit: unknown }).CanvasKit;
const { JsiSkTypeface } = require('@shopify/react-native-skia/lib/module/skia/web/JsiSkTypeface') as { JsiSkTypeface: new (ck: unknown, ref: unknown) => unknown };

beforeAll(() => {
  const proto = Object.getPrototypeOf(Skia.TypefaceFontProvider.Make()) as { matchFamilyStyle: (this: { ref: CanvasKitProvider }, name: string, style: unknown) => unknown };
  proto.matchFamilyStyle = function matchFamilyStyle(name, style) {
    const typeface = this.ref.matchFamilyStyle(name, style);
    if (typeface === null) throw new Error(`Could not find font family ${name}`);
    return new JsiSkTypeface(CK, typeface);
  };
});

const FONTS = path.resolve(__dirname, '../../../../../assets/fonts');
/** In this test a face's source is its file's name, read from assets/fonts. */
const SOURCES = Object.fromEntries(BUNDLED_FACES.map((f) => [f.id, `${f.id}.ttf`])) as FaceSources<string>;
const bytesOf = (file: string) => new Uint8Array(fs.readFileSync(path.join(FONTS, file)));
const readFile = async (file: string): Promise<SkData> => Skia.Data.fromBytes(bytesOf(file));

/** A word in each script the rim sets: Latin and Hebrew. */
const WORDS = ['Kokonada', 'מתח'];
const SIZE = 100;
const advances = (font: SkFont, word: string) => font.getGlyphWidths(font.getGlyphIDs(word));
const width = (font: SkFont, word: string) => advances(font, word).reduce((a, b) => a + b, 0);

/** The font straight from a bundled file, at SIZE. */
function fileFont(id: BundledFaceId): SkFont {
  const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(Skia.Data.fromBytes(bytesOf(`${id}.ttf`)));
  if (typeface === null) throw new Error(`${id} is not a font`);
  return Skia.Font(typeface, SIZE);
}

/** The font RimLabels sets a word in: matchFont over the font manager, the family at a weight, as its style names them. */
const laid = (mgr: SkFontMgr, family: string, weight: number) =>
  matchFont({ fontFamily: family, fontSize: SIZE, fontWeight: String(weight) as '400' }, mgr);

describe('the typeface provider: the bundled faces, by family, in a Skia font manager', () => {
  it('sets a word in every bundled face at a non-zero width, with the advances of that face’s own file', async () => {
    const mgr = await loadTypefaces({ Skia }, SOURCES, readFile);
    for (const face of BUNDLED_FACES) {
      const font = laid(mgr, face.family, face.weight);
      for (const word of WORDS) {
        expect(width(font, word)).toBeGreaterThan(0);
        expect([face.id, word, advances(font, word)]).toEqual([face.id, word, advances(fileFont(face.id), word)]);
      }
    }
    mgr.dispose();
  });

  it('the rim’s own type, type.face.ui at ui.label’s weight, is Heebo-Medium, and a weight picks its own file', async () => {
    const mgr = await loadTypefaces({ Skia }, SOURCES, readFile);
    const label = laid(mgr, BASE.type.face.ui, BASE.type.ui.label.hebrew.weight);
    expect(advances(label, WORDS[1])).toEqual(advances(fileFont('Heebo-Medium'), WORDS[1]));
    // The faces are told apart at this size: a provider that answered one file for every weight would fail above.
    expect(advances(fileFont('Heebo-SemiBold'), WORDS[0])).not.toEqual(advances(fileFont('Heebo-Light'), WORDS[0]));
    mgr.dispose();
  });

  it('holds two families, Heebo and Bellefair, the faces registered under their family and not their file', async () => {
    const mgr = await loadTypefaces({ Skia }, SOURCES, readFile);
    const families = Array.from({ length: mgr.countFamilies() }, (_, i) => mgr.getFamilyName(i)).sort();
    expect(families).toEqual([BASE.type.face.voice, BASE.type.face.ui].sort());
    expect(() => laid(mgr, 'Heebo-Medium', 400)).toThrow('Could not find font family Heebo-Medium');
    mgr.dispose();
  });

  it('a font manager without the faces sets the word in no glyphs: the defect the provider ends', () => {
    const empty = Skia.TypefaceFontProvider.Make();
    expect(() => laid(empty, BASE.type.face.ui, 500)).toThrow('Could not find font family Heebo');
    expect(width(Skia.Font(undefined, SIZE), WORDS[1])).toBe(0);
    empty.dispose();
  });

  it('reads every face once and frees each read, and each typeface once registered', async () => {
    const read: string[] = [];
    const freed: string[] = [];
    const mgr = await loadTypefaces({ Skia }, SOURCES, async (file) => {
      read.push(file);
      const data = await readFile(file);
      const dispose = data.dispose.bind(data);
      data.dispose = () => {
        freed.push(file);
        dispose();
      };
      return data;
    });
    expect(read.sort()).toEqual(Object.values(SOURCES).sort());
    expect(freed.sort()).toEqual(read);
    expect(width(laid(mgr, BASE.type.face.ui, 600), WORDS[1])).toBeGreaterThan(0);
    mgr.dispose();
  });
});

describe('the typeface provider refuses what it cannot load, naming the face', () => {
  it('a face with no source, and a source for no bundled face', async () => {
    const without = Object.fromEntries(Object.entries(SOURCES).filter(([id]) => id !== 'Heebo-Medium'));
    await expect(loadTypefaces({ Skia }, without as FaceSources<string>, readFile)).rejects.toThrow('no source for the bundled face Heebo-Medium');
    await expect(loadTypefaces({ Skia }, { ...SOURCES, 'Heebo-Bold': 'x' } as FaceSources<string>, readFile)).rejects.toThrow('a source for Heebo-Bold, which is not a bundled face');
  });

  it('a source that is not a font, and a read that fails', async () => {
    const licence = { ...SOURCES, 'Bellefair-Regular': 'OFL-Bellefair.txt' };
    await expect(loadTypefaces({ Skia }, licence, readFile)).rejects.toThrow('Bellefair-Regular (OFL-Bellefair.txt) is not a font Skia can read');
    const failing = async (file: string) => {
      if (file === SOURCES['Heebo-Light']) throw new Error('gone');
      return readFile(file);
    };
    await expect(loadTypefaces({ Skia }, SOURCES, failing)).rejects.toThrow('gone');
  });
});
