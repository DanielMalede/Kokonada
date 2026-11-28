/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { RIM_READING_ORDER, visualOrder, type RimPosition } from '../arc.ts';

// F5 (the designer's rulings, 2026-11-25): every locale's rim words pass visualOrder, so its RangeError (a word that needs
// a shaper: one that mixes directions, carries combining marks, or is in a joining script) never reaches a device, where
// RimLabels would throw while it renders.
//
// No catalogue holds plate.rim.* yet. The keys are R (regulated; the P10 spec owns them), and in a batch tree an R key
// has no text anywhere (the copy port, F3-B); no lab scene or page passes RimLabels its words yet either. So this holds
// the words the owner decided, read from DEC-036's record (he), and their English (en, the designer's V1 directions).
// Only the four arc keys are shaped: plate.rim.a11y.* are accessibility labels, never laid on the arc. When a catalogue
// gives plate.rim.* text, this reads every locale's from it, the pseudo-locale en-XA included.

const DEC_036 = path.resolve(__dirname, '../../../../../../../..', 'docs/design-v2/decisions/DEC-036.md');

/** DEC-036's words, from the designer's record of the owner's answer: the axis ends, top, bottom, right, left. */
function decidedWords(): readonly string[] {
  const record = fs.readFileSync(DEC_036, 'utf8').split('\n').find((line) => /\*\*The words on the rim:\*\* the axis ends: /.test(line));
  if (record === undefined) throw new Error(`DEC-036's record of the rim words is not where this reads it: ${DEC_036}`);
  return record.split('the axis ends: ')[1].replace(/\.\s*$/, '').split(' / ');
}

type Catalogue = Readonly<Record<string, string>>;
const ARC_KEY = /^plate\.rim\.(top|right|bottom|left)$/;
const keyOf = (position: RimPosition) => `plate.rim.${position}`;

/** The arc keys of a locale's catalogue that visualOrder refuses, each with its reason; and the arc keys it lacks. */
function refused(catalogue: Catalogue): string[] {
  const missing = RIM_READING_ORDER.map(keyOf).filter((key) => typeof catalogue[key] !== 'string');
  const bad = Object.entries(catalogue)
    .filter(([key]) => ARC_KEY.test(key))
    .flatMap(([key, text]) => {
      try {
        visualOrder(text);
        return [];
      } catch (e) {
        return [`${key}: ${(e as Error).message}`];
      }
    });
  return [...missing.map((key) => `${key}: missing`), ...bad];
}

const he = decidedWords();
const CATALOGUES: Readonly<Record<string, Catalogue>> = {
  he: Object.fromEntries(RIM_READING_ORDER.map((position, i) => [keyOf(position), he[i]])),
  en: { 'plate.rim.top': 'More energy', 'plate.rim.bottom': 'Less energy', 'plate.rim.right': 'Pleasant', 'plate.rim.left': 'Unpleasant' },
};

describe('the rim words of every locale pass visualOrder (F5)', () => {
  it('reads DEC-036’s four words from its record, one per position, all Hebrew', () => {
    expect(he).toHaveLength(4);
    for (const word of he) expect(word).toMatch(/^[א-ת ]+$/);
    expect(CATALOGUES.he['plate.rim.top']).toBe('יותר אנרגיה');
  });

  it.each(Object.keys(CATALOGUES))('%s: every arc word is there, and visualOrder lays each one', (locale) => {
    expect(refused(CATALOGUES[locale])).toEqual([]);
  });

  it('lays each in the order it is seen: the Hebrew reversed once, the English as it is', () => {
    for (const position of RIM_READING_ORDER) {
      const word = CATALOGUES.he[keyOf(position)];
      expect(visualOrder(word)).toBe(Array.from(word).reverse().join(''));
      expect(visualOrder(CATALOGUES.en[keyOf(position)])).toBe(CATALOGUES.en[keyOf(position)]);
    }
  });

  it('bites: a pointed word, a mixed one, an Arabic one or a missing key is named, and an accessibility label is never shaped', () => {
    const planted: Catalogue = {
      'plate.rim.top': 'נָעִים',
      'plate.rim.bottom': 'נעים ok',
      'plate.rim.right': 'مريح',
      // Mixed (Hebrew and a digit): refused if it were shaped, so its absence below shows it is not.
      'plate.rim.a11y.top': 'למעלה: 1',
    };
    expect(refused(planted).map((p) => p.split(':')[0])).toEqual(['plate.rim.left', 'plate.rim.top', 'plate.rim.bottom', 'plate.rim.right']);
  });
});
