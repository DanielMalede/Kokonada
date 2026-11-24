// A point on the plate: the unit disc, x to the right (pleasant), y up (more energy), as the cold lane
// stores a tap and the field reads it (placementLedger.ts Tap). The plate is LTR in every locale (R7,
// QA-088), so a point is the same physical spot under RTL.
//
// Held here until the Plate's shared geometry module lands (components/Plate/geometry.ts, lane A); the two
// are the same shape, and this one is then removed in favour of that one.

export interface PlatePoint {
  readonly x: number;
  readonly y: number;
}
