// The reader's spacing (P1 spec §B.1 item 4; §8, the Ledger line "(R2b) reader.headingGapAbove = 32, …"). Each reader.*
// token is an alias of an existing space token, owed by the token lane (LB).
//
// TODO(LB): replace each line below with its reader.* token once design-tokens/ carries it (P1 spec §8 Ledger:
// reader.headingGapAbove, reader.headingGapBelow, reader.paragraphGap, reader.listIndent, reader.measure). Until then each is
// the existing token the spec names as its value, never a number of our own.

import type { Tokens } from '../../tokens/useTokens.ts';

export interface ReaderSpace {
  /** reader.headingGapAbove (32): above a section heading that is not the first block. */
  readonly headingGapAbove: number;
  /** reader.headingGapBelow (8): between a heading and the block under it. */
  readonly headingGapBelow: number;
  /** reader.paragraphGap (16): between two blocks that are not headings. */
  readonly paragraphGap: number;
  /** reader.listIndent (24): the hanging column a list item's marker sits in. */
  readonly listIndent: number;
  /** The gap between two items of a list (P1 spec §B.1 item 4: 8). */
  readonly listItemGap: number;
  /** reader.measure (content.maxWidth): the column's widest. */
  readonly measure: number;
}

export function readerSpace(tokens: Pick<Tokens, 'base' | 'direction'>): ReaderSpace {
  const { spacing, content } = tokens.base;
  return {
    headingGapAbove: spacing['8'], // TODO(LB): reader.headingGapAbove (P1 spec §B.1 item 4, §8)
    headingGapBelow: spacing['3'], // TODO(LB): reader.headingGapBelow (P1 spec §B.1 item 4, §8)
    paragraphGap: spacing['5'], // TODO(LB): reader.paragraphGap (P1 spec §B.1 item 4, §8)
    listIndent: spacing['7'], // TODO(LB): reader.listIndent (P1 spec §B.1 item 4, §8)
    listItemGap: spacing['3'],
    measure: content.maxWidth, // TODO(LB): reader.measure (P1 spec §8)
  };
}
