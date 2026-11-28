// The shape of a bundled legal document as the LegalReader draws it (P1 spec §B), and the reader's pure rules. The text
// itself is never here: the caller injects it (ShellPorts.links.resolveLegalDoc; the lab's sample document), so nothing
// under v2 reads src/legal/documents/** (P1-R2-3).

import type { ReaderSpace } from './readerSpace.ts';

/** One block of a document's body, in reading order. */
export type LegalBlock =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly string[]; readonly ordered?: boolean };

/** A bundled document in one language: its own title, its version and preformatted date label, and its body. */
export interface LegalDocument {
  readonly title: string;
  readonly version: string;
  /** The document's own date, already formatted for its language. */
  readonly dateLabel: string;
  readonly blocks: readonly LegalBlock[];
}

/** The space above each block: none for the first, headingGapAbove above a heading, headingGapBelow under one, else paragraphGap. */
export function blockGaps(blocks: readonly LegalBlock[], space: ReaderSpace): number[] {
  return blocks.map((block, i) => {
    if (i === 0) return 0;
    if (block.kind === 'heading') return space.headingGapAbove;
    return blocks[i - 1].kind === 'heading' ? space.headingGapBelow : space.paragraphGap;
  });
}

/** A list item's marker: a bullet, or the item's number and a full stop. */
export function listMarker(ordered: boolean, index: number): string {
  return ordered ? `${index + 1}.` : '•';
}

/** LEFT-TO-RIGHT ISOLATE and POP DIRECTIONAL ISOLATE: an address reads left to right inside right-to-left text. */
export const LRI = '⁦';
export const PDI = '⁩';

// A URL (a scheme, or www.), or an email address. Its last character is never a sentence's punctuation or a closing
// bracket, which stay outside the isolate. A match never starts after an LRI or after a character an address can hold,
// so an address already isolated is left as it is, and none is matched again from inside itself (\b alone would start a
// second match at the dot of data.protection@…).
const ADDRESS = /(?<![⁦\w.%+\-@/:])(?:(?:https?:\/\/|www\.)[^\s⁩]*[^\s⁩.,;:!?)\]}'"]|[\w.%+-]+@[\w-]+(?:\.[\w-]+)+\b)/gu;

/** The text with each address LTR-isolated. Nothing else changes: no address is made a link, coloured or underlined. */
export function isolateAddresses(text: string): string {
  return text.replace(ADDRESS, (address) => `${LRI}${address}${PDI}`);
}
