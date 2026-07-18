// The Kokonada Breath — the opacity curve of the brand's single recognisable gesture, in
// ONE pure-data module so it can be shared by the RN aura components AND by the pure Node
// asset scripts (which bake the bootsplash aura at `rest`, so the OS splash and the RN
// splash breathe from the SAME value → a zero-jump handoff). No React import lives here, so
// Node's type-stripping can import it directly from the ESM build script.
//
// rest  — the resting inhale (the still-frame the OS bootsplash shows, and the low of the loop)
// peak  — the top of the breath (contrast tests judge legibility against this true peak)
// still — the fixed glow under reduced motion (no loop)
export const BREATH_OPACITY = { rest: 0.45, peak: 0.75, still: 0.55 } as const;
