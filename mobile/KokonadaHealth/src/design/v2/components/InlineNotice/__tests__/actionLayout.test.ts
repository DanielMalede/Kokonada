import { glyphOffset, noticeActionLayout } from '../actionLayout.ts';

// Build note E (the architect's round-3 G4 co-sign, DEC-198): the two actions stack when they do not fit one row, decided
// from the widths React Native measured, never from a font-scale literal. The link sits first in both layouts.

describe('noticeActionLayout: one row, or stacked, from the measured widths', () => {
  const GAP = 16;

  it('two actions that fit the column with the gap between them share one row', () => {
    expect(noticeActionLayout(300, [120, 80], GAP)).toBe('row');
  });

  it('the boundary fits: the two widths plus the gap exactly the column', () => {
    expect(noticeActionLayout(216, [120, 80], GAP)).toBe('row');
  });

  it('one dp over the column stacks them', () => {
    expect(noticeActionLayout(215, [120, 80], GAP)).toBe('stack');
  });

  it('the gap counts: two labels that fit only without it stack', () => {
    expect(noticeActionLayout(205, [120, 80], GAP)).toBe('stack');
  });

  it('a label as wide as the column on its own (it wraps there) stacks', () => {
    expect(noticeActionLayout(300, [300, 60], GAP)).toBe('stack');
  });

  it('until the column and both actions are measured, they stack: a stacked pair never runs past the column', () => {
    expect(noticeActionLayout(null, [120, 80], GAP)).toBe('stack');
    expect(noticeActionLayout(300, [null, 80], GAP)).toBe('stack');
    expect(noticeActionLayout(300, [120, null], GAP)).toBe('stack');
  });

  it('no action, or one, is never a question of stacking: one row', () => {
    expect(noticeActionLayout(null, [], GAP)).toBe('row');
    expect(noticeActionLayout(null, [null], GAP)).toBe('row');
    expect(noticeActionLayout(10, [500], GAP)).toBe('row');
  });

  it('reads no font scale: the same widths give the same layout whatever the scale was that drew them', () => {
    // The rule's whole input is the three widths and the gap (its arity), so a scale cannot enter it.
    expect(noticeActionLayout.length).toBe(3);
  });
});

describe('glyphOffset: the glyph top-aligned to the first line, from the type token and the font scale', () => {
  it('at 1.0, ui.body latin (24) and icon.s (20): 2', () => {
    expect(glyphOffset(24, 1, 20)).toBe(2);
  });

  it('at 2.0 the line is 48, so the glyph sits 14 down', () => {
    expect(glyphOffset(24, 2, 20)).toBe(14);
  });

  it('Hebrew (26) at 1.3: (33.8 − 20) ÷ 2', () => {
    expect(glyphOffset(26, 1.3, 20)).toBeCloseTo(6.9, 10);
  });

  it('never negative: a glyph taller than the line starts at the line’s top', () => {
    expect(glyphOffset(16, 1, 20)).toBe(0);
  });
});
