/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { BASE, DIRECTIONS } from '../../tokens/tokens.generated.ts';
import { BUNDLED_FACES, faceId, fontFace } from '../faces.ts';

// The v2 faces as React Native draws them (F6). React Native on Android loads fonts/<fontFamily>.ttf from the APK's
// assets by the exact file name, and picks a file by normal or bold only: a fontFamily of the type tokens' family
// ('Heebo') with a fontWeight finds no file and draws in the system face. So on Android a face is its per-weight file's
// name, with no fontWeight (the file already is the weight; a weight on top would ask for a synthetic one).

const FONTS = path.resolve(__dirname, '../../../../../assets/fonts');

/** Every numeric `weight` or `weightActive` under a type tree. */
function weightsIn(node: unknown, out = new Set<number>()): Set<number> {
  if (node === null || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'weight' || key === 'weightActive') && typeof value === 'number') out.add(value);
    else weightsIn(value, out);
  }
  return out;
}

/** The faces the type tokens' styles draw in: the UI family at every weight a UI style names, the voice family at 400. */
function tokenFaces(): Array<{ family: string; weight: number }> {
  const ui = new Set([...weightsIn(BASE.type.ui), ...Object.values(DIRECTIONS).flatMap((d) => [...weightsIn(d.type.ui)])]);
  // The voice styles carry no weight: the voice face is cut at 400 only (CMP-125), and voiceFallback is a fallback the
  // app does not bundle.
  return [...[...ui].sort().map((weight) => ({ family: BASE.type.face.ui, weight })), { family: BASE.type.face.voice, weight: 400 }];
}

describe('fontFace: the style that draws a v2 face', () => {
  it('on Android, every face the type tokens use is its per-weight file, by name, with no fontWeight', () => {
    const faces = tokenFaces();
    expect(faces.map((f) => `${f.family}@${f.weight}`)).toEqual(['Heebo@300', 'Heebo@400', 'Heebo@500', 'Heebo@600', 'Bellefair@400']);
    expect(faces.map((f) => fontFace(f.family, f.weight, 'android'))).toEqual([
      { fontFamily: 'Heebo-Light' },
      { fontFamily: 'Heebo-Regular' },
      { fontFamily: 'Heebo-Medium' },
      { fontFamily: 'Heebo-SemiBold' },
      { fontFamily: 'Bellefair-Regular' },
    ]);
    for (const f of faces) expect(fontFace(f.family, f.weight, 'android')).not.toHaveProperty('fontWeight');
  });

  it('on Android, every face the type tokens use resolves to a file assets/fonts holds', () => {
    const files = new Set(fs.readdirSync(FONTS));
    const missing = tokenFaces().map((f) => `${fontFace(f.family, f.weight, 'android').fontFamily}.ttf`).filter((file) => !files.has(file));
    expect(missing).toEqual([]);
  });

  it('the bundled faces are exactly the font files in assets/fonts, each named for its family and weight', () => {
    const files = fs.readdirSync(FONTS).filter((f) => /\.(ttf|otf)$/i.test(f)).sort();
    expect(files.length).toBeGreaterThan(0);
    expect(BUNDLED_FACES.map((f) => `${f.id}.ttf`).sort()).toEqual(files);
    for (const f of BUNDLED_FACES) expect(faceId(f.family, f.weight)).toBe(f.id);
  });

  it('throws on a family or a weight no bundled file cuts, naming both', () => {
    expect(() => fontFace('Heebo', 700, 'android')).toThrow('no bundled font file draws Heebo at 700');
    expect(() => fontFace('Bellefair', 600, 'android')).toThrow('no bundled font file draws Bellefair at 600');
    expect(() => fontFace(BASE.type.face.voiceFallback, BASE.type.face.voiceFallbackWeight, 'android')).toThrow('no bundled font file draws Frank Ruhl Libre at 300');
    expect(() => fontFace('Heebo', 700, 'ios')).toThrow('no bundled font file draws Heebo at 700');
  });

  it('on iOS (frozen, untested on a device) keeps the family and the weight, which iOS matches inside the family', () => {
    expect(fontFace('Heebo', 600, 'ios')).toEqual({ fontFamily: 'Heebo', fontWeight: '600' });
    expect(fontFace('Bellefair', 400, 'ios')).toEqual({ fontFamily: 'Bellefair', fontWeight: '400' });
  });

  it('takes the platform React Native runs on when none is given (the jest preset’s, iOS)', () => {
    const os = require('react-native').Platform.OS;
    expect(os).toBe('ios');
    expect(fontFace('Heebo', 500)).toEqual(fontFace('Heebo', 500, os));
    expect(fontFace('Heebo', 500)).not.toEqual(fontFace('Heebo', 500, 'android'));
  });
});

describe('faceId: a face id is the family without spaces and the OpenType style name of the weight', () => {
  it('names the upstream static files', () => {
    expect(faceId('Heebo', 300)).toBe('Heebo-Light');
    expect(faceId('Heebo', 400)).toBe('Heebo-Regular');
    expect(faceId('Heebo', 500)).toBe('Heebo-Medium');
    expect(faceId('Heebo', 600)).toBe('Heebo-SemiBold');
    expect(faceId('Frank Ruhl Libre', 300)).toBe('FrankRuhlLibre-Light');
    expect(() => faceId('Heebo', 450)).toThrow('450 is not a named OpenType weight');
  });
});
