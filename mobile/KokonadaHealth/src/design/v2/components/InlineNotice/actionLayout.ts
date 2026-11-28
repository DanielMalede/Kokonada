// The InlineNotice's two pure rules (P1 spec §3.1; the architect's build note E, DEC-198).

/** How the notice's actions sit: on one row (the link at the start, the button at the end), or stacked, the link first. */
export type NoticeActionLayout = 'row' | 'stack';

/**
 * The layout of the actions, from what React Native measured: the text column's width and each action's own width. Two
 * actions share one row only when both widths and the gap between them fit the column. Until all three are measured they
 * stack, since a stacked pair never runs past the column. No action, or one, is one row. It reads no font scale: the
 * widths already are the labels at the scale that drew them.
 */
export function noticeActionLayout(column: number | null, widths: readonly (number | null)[], gap: number): NoticeActionLayout {
  if (widths.length < 2) return 'row';
  if (column === null || widths.some((w) => w === null)) return 'stack';
  const needed = (widths as readonly number[]).reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
  return needed <= column ? 'row' : 'stack';
}

/**
 * How far down the glyph sits so it is centred on the text's first line: (the line height at this font scale − the glyph)
 * ÷ 2, from the type token and the window's font scale, and never above the line's top.
 */
export function glyphOffset(lineHeight: number, fontScale: number, glyph: number): number {
  return Math.max(0, (lineHeight * fontScale - glyph) / 2);
}
