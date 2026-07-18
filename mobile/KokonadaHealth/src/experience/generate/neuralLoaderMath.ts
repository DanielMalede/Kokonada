// Pure geometry + colour math for the Neural-Analysis Loader (Genesis). Every
// per-frame value that reaches the Skia surface is derived here and kept FINITE —
// a single NaN in a Skia transform blanks or crashes the whole canvas (the BioAura
// §B.2 precedent). Deterministic and unit-tested; the component is a thin surface.

import { emotionAnchors } from '../../design/tokens';
import { parseHex } from '../../design/contrast';

export type RGB = [number, number, number];

function anchorRgb(hex: string): RGB {
  const { r, g, b } = parseHex(hex);
  return [r, g, b];
}

export interface Node3 {
  x: number;
  y: number;
  z: number;
  phase: number; // 0..2π — per-node pulse offset so the net shimmers, alive
}

export interface Projected {
  px: number; // -1..1 (× sphere radius on device)
  py: number; // -1..1
  depth: number; // 0 (back) .. 1 (front) — for depth-cued alpha/size
  phase: number;
}

// Engagement heat ramp anchors — cyan (calm) → coral → red (peak) — sourced from the design
// tokens (emotionAnchors calm/coral/peak) so the loader's colour tracks the palette with zero
// drift. Exported for tests. (parseHex on a static token literal cannot throw.)
export const CYAN: RGB = anchorRgb(emotionAnchors.calm);  // #31E1C4
export const CORAL: RGB = anchorRgb(emotionAnchors.coral); // #FF8A73
export const RED: RGB = anchorRgb(emotionAnchors.peak);   // #FF5A5A

const TWO_PI = Math.PI * 2;

export function clamp01(x: number): number {
  'worklet';
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0; // +∞→1, -∞/NaN→0
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Even point distribution on the unit sphere (golden-angle spiral). The per-node
// pulse phase is the spiral angle wrapped into [0,2π) — varied but deterministic.
export function fibonacciSphere(n: number): Node3[] {
  const out: Node3[] = [];
  if (!(n > 0)) return [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  const denom = n > 1 ? n - 1 : 1; // n===1 must not divide by zero
  for (let i = 0; i < n; i++) {
    const y = n > 1 ? 1 - (i / denom) * 2 : 0;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * ga;
    out.push({
      x: Math.cos(th) * r,
      y,
      z: Math.sin(th) * r,
      phase: ((th % TWO_PI) + TWO_PI) % TWO_PI,
    });
  }
  return out;
}

// Reticulation: connect each node to its k nearest neighbours (largest dot product
// = smallest angle), de-duplicated into canonical (a<b) undirected edges.
export function nearestEdges(nodes: Node3[], k: number): [number, number][] {
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  const n = nodes.length;
  for (let i = 0; i < n; i++) {
    const dots: [number, number][] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const a = nodes[i];
      const b = nodes[j];
      dots.push([a.x * b.x + a.y * b.y + a.z * b.z, j]);
    }
    dots.sort((p, q) => q[0] - p[0]);
    const lim = Math.min(k, dots.length);
    for (let m = 0; m < lim; m++) {
      const j = dots[m][1];
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      const key = lo + '-' + hi;
      if (!seen.has(key)) { seen.add(key); edges.push([lo, hi]); }
    }
  }
  return edges;
}

// Rotate a node (Y then X) and orthographically project. Rotation preserves length,
// so a unit node stays within the [-1,1] plane and depth within [0,1]. Every input
// is finite-guarded so the surface can never receive NaN.
export function projectNode(node: Node3, ry: number, rx: number): Projected {
  'worklet';
  const fx = Number.isFinite(node.x) ? node.x : 0;
  const fy = Number.isFinite(node.y) ? node.y : 0;
  const fz = Number.isFinite(node.z) ? node.z : 0;
  const a = Number.isFinite(ry) ? ry : 0;
  const b = Number.isFinite(rx) ? rx : 0;
  const cry = Math.cos(a), sry = Math.sin(a), crx = Math.cos(b), srx = Math.sin(b);
  const x1 = fx * cry + fz * sry;
  const z1 = -fx * sry + fz * cry;
  const y2 = fy * crx - z1 * srx;
  const z2 = fy * srx + z1 * crx;
  return {
    px: x1,
    py: y2,
    depth: (z2 + 1) / 2,
    phase: Number.isFinite(node.phase) ? node.phase : 0,
  };
}

// Engagement → colour. Ramps cyan → coral and is CAPPED there — it never reaches the peak RED
// (never-alarming-red ethic, matching the aura's hrGlowColor). RED is retained as the token
// triad's hot anchor but is deliberately unused by the ramp.
export function heat(e: number): RGB {
  'worklet';
  const t = clamp01(e);
  return [
    Math.round(CYAN[0] + (CORAL[0] - CYAN[0]) * t),
    Math.round(CYAN[1] + (CORAL[1] - CYAN[1]) * t),
    Math.round(CYAN[2] + (CORAL[2] - CYAN[2]) * t),
  ];
}
