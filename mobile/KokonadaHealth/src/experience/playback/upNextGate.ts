// DEC-099 (owner ruling; HX-4 M4, DT-4 option C): Up Next is hidden until P3. Its rows show each
// track's title and artist with no link-back to that track, which Spotify Developer Policy II.4
// requires (CMP-008). So until P3 Now Playing draws no Up Next entry, and the sheet renders nothing
// wherever it is mounted.
//
// Re-enabling is a one-line change here, but only after every row links to its own item. The value
// is pinned by UpNextSheet.gate.test.tsx, so turning it on is a visible act in review.
export const UP_NEXT_ENABLED = false;
