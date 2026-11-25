/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { BASE, DIRECTIONS } from '../../v2/tokens/tokens.generated';
import {
  CALIBRATION_TEXT, FACE_MIN_DIFF_DP, FALLBACK_PROBE, FONT_CHECK_DEADLINE_MS, LAB_FACES, MISSING_FACE, createFontCheck,
  faceId, unknownFaces, type LabFaceId,
} from '../fonts';
import { SETTING_READ_DEADLINE_MS } from '../settingRead';
import { faceId as v2FaceId, fontFace } from '../../v2/typeface/faces';

// UI-072 and the v2 type scale (LEDGER §5.4). The lab's faces are named by the font file React Native looks them up by on
// Android (fonts/<id>.ttf in the APK's assets), which for an upstream static cut is also its PostScript name, the name iOS
// looks it up by. React Native on Android picks a file by family name and normal-or-bold only, so every weight is its own
// family: Heebo-Medium, never Heebo with fontWeight 500.

/** Every numeric `weight` or `weightActive` under a type tree. */
function weightsIn(node: unknown, out = new Set<number>()): Set<number> {
  if (node === null || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if ((key === 'weight' || key === 'weightActive') && typeof value === 'number') out.add(value);
    else weightsIn(value, out);
  }
  return out;
}

describe('the lab faces are the faces the v2 type tokens name', () => {
  it('Heebo at every UI weight the tokens use, and Bellefair at 400, and nothing else', () => {
    const ui = new Set([...weightsIn(BASE.type.ui), ...Object.values(DIRECTIONS).flatMap((d) => [...weightsIn(d.type.ui)])]);
    const expected = [...[...ui].map((w) => faceId(BASE.type.face.ui, w)), faceId(BASE.type.face.voice, 400)].sort();
    expect(Object.keys(LAB_FACES).sort()).toEqual(expected);
    // The ledger's §5.4 as of 2026-11-23: display 300; body, legal and caption 400; title, label and nav 500; cta and the
    // active nav 600; the voice face 400 only.
    expect(expected).toEqual(['Bellefair-Regular', 'Heebo-Light', 'Heebo-Medium', 'Heebo-Regular', 'Heebo-SemiBold']);
  });

  it('each face records its family and weight, and its id is made from them', () => {
    for (const [id, face] of Object.entries(LAB_FACES)) expect(faceId(face.family, face.weight)).toBe(id);
  });

  it('one source of truth with v2: the lab names a face by v2’s faceId, and each lab face is the file v2’s fontFace draws on Android', () => {
    expect(faceId).toBe(v2FaceId);
    for (const [id, face] of Object.entries(LAB_FACES)) expect(fontFace(face.family, face.weight, 'android')).toEqual({ fontFamily: id });
  });

  it('the voice face is never cut above 400 (CMP-125: hierarchy from size and space; Android would draw a synthetic bold)', () => {
    const voice = Object.values(LAB_FACES).filter((f) => f.family === BASE.type.face.voice);
    expect(voice.map((f) => f.weight)).toEqual([400]);
  });

  it('every face is a font file the app holds: assets/fonts/<id>.ttf, the file React Native on Android looks it up by', () => {
    const dir = path.resolve(__dirname, '../../../../assets/fonts');
    expect(Object.keys(LAB_FACES).filter((id) => !fs.existsSync(path.join(dir, `${id}.ttf`)))).toEqual([]);
  });

  it('a face id is the family without spaces and the OpenType style name of the weight, as upstream files are named', () => {
    expect(faceId('Heebo', 300)).toBe('Heebo-Light');
    expect(faceId('Heebo', 400)).toBe('Heebo-Regular');
    expect(faceId('Heebo', 500)).toBe('Heebo-Medium');
    expect(faceId('Heebo', 600)).toBe('Heebo-SemiBold');
    expect(faceId('Frank Ruhl Libre', 300)).toBe('FrankRuhlLibre-Light');
    expect(() => faceId('Heebo', 450)).toThrow('450 is not a named OpenType weight');
  });
});

describe('the calibration that tells a face from the fallback', () => {
  it('the fallback probe asks for a family no font and no system alias can answer, so React Native draws its default face', () => {
    expect(Object.keys(LAB_FACES)).not.toContain(MISSING_FACE);
    expect(['System', 'sans-serif', 'serif', 'monospace', 'Roboto', 'sans-serif-medium']).not.toContain(MISSING_FACE);
    expect(MISSING_FACE).toMatch(/^[A-Za-z]+$/);
    expect(FALLBACK_PROBE).not.toMatch(/-/); // never a face id, which always has the style after a hyphen
  });

  it('the calibration line is the whole Hebrew alphabet, finals included, and nothing else', () => {
    // Heebo's Latin and digits are Roboto's (the Android fallback): summed from the font files' advances, "Kokonada"
    // differs by 0.07% and the digits by 0.00% at Regular, so a Latin line would refuse Heebo even when applied. This line
    // in Heebo differs from Noto Sans Hebrew (the Hebrew fallback) by 1.1% at Light to 7.6% at SemiBold, and in Bellefair
    // by 24%.
    const letters = [...CALIBRATION_TEXT].map((c) => c.codePointAt(0) as number);
    const alphabet = Array.from({ length: 0x05ea - 0x05d0 + 1 }, (_, i) => 0x05d0 + i);
    expect(letters).toEqual(alphabet);
  });

  it('a face is one that drew at least a dp from the fallback; layout rounds to the pixel, so less is the same face', () => {
    expect(FACE_MIN_DIFF_DP).toBe(1);
  });

  it('waits as long as a setting read, which is at most half of every capture plan\'s READY timeout', () => {
    expect(FONT_CHECK_DEADLINE_MS).toBe(SETTING_READ_DEADLINE_MS);
  });
});

describe('createFontCheck', () => {
  const faces: readonly LabFaceId[] = ['Heebo-Regular', 'Bellefair-Regular'];
  /** The error for a face whose line drew at the fallback's width: the face, the width, and the file React Native looked for. */
  const fellBack = (face: string, width: number) =>
    `font "${face}" is not applied: its calibration line drew at ${width} dp, the width of the fallback face, so React Native did not find fonts/${face}.ttf in the APK's assets`;

  it('a scene with no faces is judged at once, and applied', () => {
    expect(createFontCheck([]).verdict()).toEqual({ settled: true, error: null });
  });

  it('pending until every face and the fallback have a width; then applied when each is a dp or more from the fallback', () => {
    const check = createFontCheck(faces);
    expect(check.measure('Heebo-Regular', 413.5)).toEqual({ settled: false });
    expect(check.measure('Bellefair-Regular', 302)).toEqual({ settled: false });
    expect(check.unmeasured()).toEqual([FALLBACK_PROBE]);
    expect(check.measure(FALLBACK_PROBE, 395.25)).toEqual({ settled: true, error: null });
    expect(check.unmeasured()).toEqual([]);
  });

  it('a face under a dp from the fallback is refused, by name, with its file; the others are not named', () => {
    const check = createFontCheck(faces);
    check.measure(FALLBACK_PROBE, 395.25);
    check.measure('Heebo-Regular', 413.5);
    expect(check.measure('Bellefair-Regular', 395.9)).toEqual({ settled: true, error: fellBack('Bellefair-Regular', 395.9) });
  });

  it('every face that fell back is named, in the scene\'s order, in one error', () => {
    const check = createFontCheck(faces);
    check.measure(FALLBACK_PROBE, 395.25);
    check.measure('Bellefair-Regular', 395.25);
    const v = check.measure('Heebo-Regular', 395.25);
    expect(v.settled && v.error).toBe(`${fellBack('Heebo-Regular', 395.25)}; ${fellBack('Bellefair-Regular', 395.25)}`);
  });

  it('a width that is not finite settles it as an error at once, naming the probe', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const check = createFontCheck(faces);
      expect(check.measure(FALLBACK_PROBE, bad)).toEqual({
        settled: true, error: `the font probe "${FALLBACK_PROBE}" reported a width that is not a finite number (${bad})`,
      });
    }
  });

  it('once settled, a later width changes nothing', () => {
    const check = createFontCheck(['Heebo-Regular']);
    check.measure(FALLBACK_PROBE, 395.25);
    const first = check.measure('Heebo-Regular', 413.5);
    expect(check.measure('Heebo-Regular', 395.25)).toBe(first);
    expect(check.verdict()).toBe(first);
  });

  it('a width for a probe the scene did not declare is ignored', () => {
    const check = createFontCheck(['Heebo-Regular']);
    check.measure('Bellefair-Regular', 395.25);
    expect(check.unmeasured()).toEqual(['Heebo-Regular', FALLBACK_PROBE]);
  });
});

describe('unknownFaces', () => {
  it('names each declared face that is not a lab face, once, in order', () => {
    expect(unknownFaces(['Heebo-Regular', 'Nope-Regular', 'Heebo-Bold', 'Nope-Regular'])).toEqual(['Nope-Regular', 'Heebo-Bold']);
    expect(unknownFaces([])).toEqual([]);
    expect(unknownFaces(Object.keys(LAB_FACES))).toEqual([]);
  });
});
