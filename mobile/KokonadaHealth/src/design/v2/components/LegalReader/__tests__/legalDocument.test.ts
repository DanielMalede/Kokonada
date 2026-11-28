import { BASE, DIRECTIONS } from '../../../tokens/tokens.generated.ts';
import { blockGaps, isolateAddresses, listMarker, LRI, PDI, type LegalBlock } from '../legalDocument.ts';
import { readerSpace } from '../readerSpace.ts';

// P1 spec §B.1 item 4 and §B.2: the reader's document body. The spacing between blocks, the markers of a list, and the
// addresses inside the text, LTR-isolated within RTL and never made pressable.

const SPACE = readerSpace({ base: BASE, direction: DIRECTIONS.abyss });

describe('readerSpace: the reader.* aliases the spec names (owed by the token lane, LB)', () => {
  it('each is the existing token the spec names as its value: 32, 8, 16, 24 and content.maxWidth', () => {
    expect(SPACE).toEqual({
      headingGapAbove: BASE.spacing['8'],
      headingGapBelow: BASE.spacing['3'],
      paragraphGap: BASE.spacing['5'],
      listIndent: BASE.spacing['7'],
      listItemGap: BASE.spacing['3'],
      measure: BASE.content.maxWidth,
    });
    expect([SPACE.headingGapAbove, SPACE.headingGapBelow, SPACE.paragraphGap, SPACE.listIndent, SPACE.measure]).toEqual([32, 8, 16, 24, 560]);
  });
});

describe('blockGaps: the space above each block', () => {
  const h = (text = 'H'): LegalBlock => ({ kind: 'heading', text });
  const p = (text = 'P'): LegalBlock => ({ kind: 'paragraph', text });
  const l = (): LegalBlock => ({ kind: 'list', items: ['a'] });

  it('the first block, a heading or not, has none', () => {
    expect(blockGaps([h()], SPACE)).toEqual([0]);
    expect(blockGaps([p()], SPACE)).toEqual([0]);
  });

  it('a heading after anything: headingGapAbove (32); the block after a heading: headingGapBelow (8)', () => {
    expect(blockGaps([p(), h(), p()], SPACE)).toEqual([0, 32, 8]);
    expect(blockGaps([h(), h()], SPACE)).toEqual([0, 32]);
    expect(blockGaps([h(), l()], SPACE)).toEqual([0, 8]);
  });

  it('a paragraph or a list after a paragraph or a list: paragraphGap (16)', () => {
    expect(blockGaps([p(), p(), l(), p()], SPACE)).toEqual([0, 16, 16, 16]);
  });

  it('an empty document has no gaps', () => {
    expect(blockGaps([], SPACE)).toEqual([]);
  });
});

describe('listMarker', () => {
  it('a bullet for an unordered list, the item’s number and a full stop for an ordered one', () => {
    expect([listMarker(false, 0), listMarker(false, 4)]).toEqual(['•', '•']);
    expect([listMarker(true, 0), listMarker(true, 9)]).toEqual(['1.', '10.']);
  });
});

describe('isolateAddresses: an address inside the text is LTR-isolated, and nothing else changes', () => {
  const iso = (s: string) => `${LRI}${s}${PDI}`;

  it('uses the left-to-right isolate and the pop (U+2066, U+2069)', () => {
    expect([LRI, PDI]).toEqual(['⁦', '⁩']);
  });

  it('isolates a URL and leaves the sentence’s full stop outside it', () => {
    expect(isolateAddresses('See https://example.org/privacy.')).toBe(`See ${iso('https://example.org/privacy')}.`);
  });

  it('isolates an email address inside Hebrew text', () => {
    expect(isolateAddresses('כתבו אל privacy@example.org ונענה.')).toBe(`כתבו אל ${iso('privacy@example.org')} ונענה.`);
  });

  it('isolates each of several, and a www. address, with its path and query', () => {
    expect(isolateAddresses('a http://x.example/a?b=1, b www.example.com/p; c')).toBe(`a ${iso('http://x.example/a?b=1')}, b ${iso('www.example.com/p')}; c`);
  });

  it('keeps a closing parenthesis outside the address', () => {
    expect(isolateAddresses('(https://example.org)')).toBe(`(${iso('https://example.org')})`);
  });

  it('leaves text with no address unchanged, and never isolates twice', () => {
    expect(isolateAddresses('No address here. Version 3, 1 March 2026.')).toBe('No address here. Version 3, 1 March 2026.');
    const once = isolateAddresses('at https://example.org now');
    expect(isolateAddresses(once)).toBe(once);
    // An address with a dot before its @ is never matched again from inside the isolate.
    const mail = isolateAddresses('write to data.protection@example.org today');
    expect(mail).toBe(`write to ${iso('data.protection@example.org')} today`);
    expect(isolateAddresses(mail)).toBe(mail);
  });
});
