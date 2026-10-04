// Probe geometry (MB-085): where a probed element is, in dp (how the layout is written) and in
// physical pixels (how the capture is read). px = dp x the device's pixel ratio, unrounded; the
// harness decides how to round when it samples.

export type Rect = { x: number; y: number; width: number; height: number };
export type ProbeRect = { dp: Rect; px: Rect };

export function toPixels(rect: Rect, ratio: number): Rect {
  return { x: rect.x * ratio, y: rect.y * ratio, width: rect.width * ratio, height: rect.height * ratio };
}

/** The rect in dp and px, or null when it is not a measurement (not finite, or a negative size). */
export function probeRect(dp: Rect, ratio: number): ProbeRect | null {
  const values = [dp.x, dp.y, dp.width, dp.height, ratio];
  if (!values.every(Number.isFinite) || dp.width < 0 || dp.height < 0 || !(ratio > 0)) return null;
  return { dp: { ...dp }, px: toPixels(dp, ratio) };
}
