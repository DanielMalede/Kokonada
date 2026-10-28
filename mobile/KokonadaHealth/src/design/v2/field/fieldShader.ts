// The field shader (minimal F9): one SkSL runtime effect, swapped by uniforms (DEC-011). It is the
// SkSL twin of fieldLaw.ts, line for line, and fieldShader.skia.test.ts holds the two to ±1 LSB on
// every pixel in real Skia. Anything that depends on t, s, c, the breath or the placements arrives
// as a uniform (uniforms.ts): n, the breath and every oscillator are computed in JS, never here.
//
// One child: uBlueNoise, the 64×64 blue-noise tile (R the dither, G the grain), sampled per pixel
// with nearest filtering and repeat tiling.
//
// Colour maths in float: OKLab to LMS, cubed, to linear sRGB (CSS Color 4's matrices, composed
// once here in float64), clamped, then the sRGB transfer function.

import { LMS_TO_XYZ, XYZ_TO_LINEAR_SRGB, OKLAB_TO_LMS, type Matrix } from '../color/oklab.ts';
import { NODE_SLOTS, QUIET_SLOTS, ROUTED_EDGES, SHADOW_SLOTS, WAYPOINT_EDGES } from './fieldLaw.ts';
import { FIELD_UNIFORMS } from './uniforms.ts';

const compose = (a: Matrix, b: Matrix): number[][] =>
  [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]));

const LMS_TO_LINEAR_SRGB = compose(XYZ_TO_LINEAR_SRGB, LMS_TO_XYZ);
const literal = (v: number) => {
  const s = v.toPrecision(17);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};
const row = (m: readonly (readonly number[])[], r: number) => `float3(${m[r].map(literal).join(', ')})`;

const typeOf = (floats: number) => (floats === 1 ? 'float' : `float${floats}`);
// isWaypoint is generated from the law's own edge tables (fieldLaw.ts), so the two cannot disagree on
// which pairs mix through N; the Skia pair test and graphConformance.test.ts check both.
const nodeId = (node: number) => `${node}.0`;
const either = (edges: ReadonlyArray<readonly [number, number]>) =>
  edges.length === 0
    ? 'false'
    : edges.map(([x, y]) => `(a == ${nodeId(x)} && b == ${nodeId(y)}) || (a == ${nodeId(y)} && b == ${nodeId(x)})`).join(' || ');
const declarations = FIELD_UNIFORMS.map((u) => `uniform ${typeOf(u.floats)} ${u.name};`).join('\n');
const nodes = Array.from({ length: NODE_SLOTS }, (_, k) => k);
const quietSlots = Array.from({ length: QUIET_SLOTS }, (_, k) => k);
const shadowSlots = Array.from({ length: SHADOW_SLOTS }, (_, k) => k);

export const FIELD_SKSL = `${declarations}
uniform shader uBlueNoise;

float sstep(float e0, float e1, float x) {
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float mod289(float x) { return x - 289.0 * floor(x / 289.0); }
float hash289(float x) { return mod289((x * 34.0 + 1.0) * x); }
float corner(float ix, float iy) { return hash289(mod289(hash289(mod289(ix)) + mod289(iy))) / 289.0; }

float vnoise(float2 p) {
  float ix = floor(p.x);
  float iy = floor(p.y);
  float fx = p.x - ix;
  float fy = p.y - iy;
  float ux = fx * fx * (3.0 - 2.0 * fx);
  float uy = fy * fy * (3.0 - 2.0 * fy);
  float c00 = corner(ix, iy);
  float c10 = corner(ix + 1.0, iy);
  float c01 = corner(ix, iy + 1.0);
  float c11 = corner(ix + 1.0, iy + 1.0);
  float bottom = c00 + (c10 - c00) * ux;
  float top = c01 + (c11 - c01) * ux;
  return bottom + (top - bottom) * uy;
}

float fbm(float2 p) {
  float w2 = uOctaves > 2.5 ? 0.25 : 0.0;
  float sum = vnoise(p) + 0.5 * vnoise(p * 2.0) + w2 * vnoise(p * 4.0);
  return sum / (1.0 + 0.5 + w2);
}

// The lobe with a core (law round 2, designer L1): rho = r^2/(d^2 + kappa r^2), at most 1/kappa; a lobe
// of radius 0 is nothing.
float lobe(float4 node, float2 qw) {
  float2 dv = qw - node.xy;
  float r2 = node.z * node.z;
  return r2 > 0.0 ? r2 / (dv.x * dv.x + dv.y * dv.y + uSelect.z * r2) : 0.0;
}

// The halo's shape eta: 1 inside the bead, 0 at the halo radius, and 0 beyond the rim or for a rest lobe.
float haloShape(float4 bead, float2 q, float d) {
  if (bead.z < 0.5 || d > 1.0) return 0.0;
  float2 dv = q - bead.xy;
  return 1.0 - sstep(uGeom2.z, uGeom2.w, sqrt(dv.x * dv.x + dv.y * dv.y));
}

// A node's colour (designer 2.1): a bead node's field colour turned by the shimmer gives way to its
// steady halo colour where its halo reaches the field's weight; a rest lobe is its turned field
// colour. Written (1 − w)·turned + w·halo, so where w = 1 it is the halo bit for bit.
float3 nodeColour(float3 field, float3 haloColour, float hasHalo, float h, float kField) {
  float3 turned = float3(field.x, field.y * uShimmer.x - field.z * uShimmer.y, field.y * uShimmer.y + field.z * uShimmer.x);
  float w = hasHalo > 0.5 ? sstep(-0.05, 0.0, h - kField) : 0.0;
  return (1.0 - w) * turned + w * haloColour;
}

// One quiet zone's factor at p (render px), the rect grown by g and rounded (designer r3 §1): 0 on the
// grown boundary and inside it; a smoothstep over the feather, or a step where there is none.
float quietOne(float4 r, float2 p) {
  float2 qd = abs(p - r.xy) - r.zw;
  float sd = length(max(qd, float2(0.0))) + min(max(qd.x, qd.y), 0.0) - uQuietParams.x;
  return uQuietParams.y > 0.0 ? sstep(0.0, uQuietParams.y, sd) : (sd > 0.0 ? 1.0 : 0.0);
}

// The product over the zones in use: an unused slot is inert through the count only.
float quiet(float2 p) {
  float product = 1.0;
${quietSlots.map((k) => `  if (uQuietParams.z > ${k}.5) { product *= quietOne(uQuiet${k}, p); }`).join('\n')}
  return product;
}

// One plate shadow's term on the ground's L at q (designer 2.9): outer outside the rim, inner on the
// face; an inert slot (mode 0) adds nothing.
float shadowOne(float4 s, float2 q, float region) {
  if (s.w == 0.0) { return 0.0; }
  float dy = q.y - s.x;
  float dist = sqrt(q.x * q.x + dy * dy);
  if (s.w > 0.0 && region >= 2.0) { return s.z * sstep(-s.y, s.y, 1.0 - dist); }
  if (s.w < 0.0 && region == 0.0) { return s.z * sstep(-s.y, s.y, dist - uGeom.w); }
  return 0.0;
}

bool isWaypoint(float a, float b) {
  return ${either(WAYPOINT_EDGES)} ||
    (uSelect.y > 0.5 && (${either(ROUTED_EDGES)}));
}

float encode(float x) {
  return x > 0.0031308 ? 1.055 * pow(x, 1.0 / 2.4) - 0.055 : 12.92 * x;
}

half4 main(float2 p) {
  float2 q = float2(p.x - uGeom.x, -(p.y - uGeom.y)) / uGeom.z;
  float d = sqrt(q.x * q.x + q.y * q.y);
  float region = d < uGeom.w ? 0.0 : (d <= 1.0 ? 1.0 : (d < uGeom2.x ? 2.0 : 3.0));

  float3 ground = uGroundOutside;
  float extent = uMask.x * (uGeom2.y > 0.0 ? sstep(uGeom2.x, uGeom2.x + uGeom2.y, d) : 1.0);
  if (region == 0.0) {
    float rho2 = (d / uGeom.w) * (d / uGeom.w);
    ground = float3(uGroundFace.x * (1.0 + uFace.x * rho2) + uFace.y * (1.0 - rho2), uGroundFace.y, uGroundFace.z);
    extent = uMask.y;
  } else if (region == 1.0) {
    ground = uGroundRing;
    extent = uMask.z;
  } else if (region == 2.0) {
    extent = 0.0;
  }
  // The plate's shadows on the ground's L, and the quiet zones on the extent (gated: no value changes).
  ground.x = ground.x * (1.0 - (${shadowSlots.map((k) => `shadowOne(uShadow${k}, q, region)`).join(' + ')}));
  extent = extent > 0.0 ? extent * quiet(p) : 0.0;

  float2 qw = float2(
    q.x + uWarp.x * (fbm(float2(1.4 * q.x + uWarp.y * uWarp.z, 1.4 * q.y + uWarp.y * uWarp.w)) - 0.5),
    q.y + uWarp.x * (fbm(float2(1.4 * q.x + 5.2 + uWarp.y * uWarp.w, 1.4 * q.y + 1.3 + uWarp.y * uWarp.z)) - 0.5));

  // A slot at fade 0 is skipped by a uniform branch: every term it adds is 0.
${nodes.map((k) => `  float rho${k} = 0.0;\n  float eta${k} = 0.0;\n  float h${k} = 0.0;\n  if (uNode${k}.w > 0.0) {\n    rho${k} = lobe(uNode${k}, qw);\n    eta${k} = haloShape(uNode${k}Bead, q, d);\n    h${k} = uNode${k}.w * (uWeight.z * eta${k});\n  }`).join('\n')}
  float fSum = ${nodes.map((k) => `uNode${k}.w * rho${k}`).join(' + ')};
  // The halos add, up to the peak (designer L2).
  float H = min(uWeight.z, ${nodes.map((k) => `h${k}`).join(' + ')});
  float kField = uWeight.x * sstep(0.55, 1.6, fSum) * extent;
  float k = min(max(kField, H), uWeight.y);

  float3 colour = ground;
  float e[${NODE_SLOTS}];
  // The selection weight, linear in each node's fade (designer L3).
${nodes.map((k) => `  e[${k}] = uNode${k}.w * (extent * rho${k} + uSelect.x * eta${k});`).join('\n')}
  float eMax = e[0];
  for (int i = 1; i < ${NODE_SLOTS}; i++) { eMax = max(eMax, e[i]); }
  if (eMax > 0.0) {
    float3 c[${NODE_SLOTS}];
    float ids[${NODE_SLOTS}];
${nodes.map((k) => `    c[${k}] = nodeColour(uNode${k}Field, uNode${k}Halo, uNode${k}Bead.z, h${k}, kField);\n    ids[${k}] = uNode${k}Bead.w;`).join('\n')}
    // topTwoSoft: the strongest node, then the next, then the third; ties go to the lower slot.
    int i1 = 0;
    float e1 = e[0];
    for (int i = 1; i < ${NODE_SLOTS}; i++) { if (e[i] > e1) { e1 = e[i]; i1 = i; } }
    int i2 = i1 == 0 ? 1 : 0;
    float e2 = 0.0;
    for (int i = 0; i < ${NODE_SLOTS}; i++) { if (i == i2) { e2 = e[i]; } }
    for (int i = 0; i < ${NODE_SLOTS}; i++) { if (i != i1 && e[i] > e2) { e2 = e[i]; i2 = i; } }
    float e3 = 0.0;
    for (int i = 0; i < ${NODE_SLOTS}; i++) { if (i != i1 && i != i2 && e[i] > e3) { e3 = e[i]; } }
    float3 c1 = c[0];
    float3 c2 = c[0];
    float id1 = 0.0;
    float id2 = 0.0;
    for (int i = 0; i < ${NODE_SLOTS}; i++) {
      if (i == i1) { c1 = c[i]; id1 = ids[i]; }
      if (i == i2) { c2 = c[i]; id2 = ids[i]; }
    }
    // The seam (law round 2, designer L5): each of the two weighted by its lead over the third; the
    // guard keeps an exact triple tie finite.
    float w1 = e1 - e3;
    float w2 = e2 - e3;
    float t = w1 > 0.0 ? w2 / (w1 + w2) : 0.0;
    float3 pair = c1;
    if (isWaypoint(id1, id2)) {
      float s = 2.0 * t;
      float nL = (c1.x + c2.x) / 2.0;
      pair = float3(c1.x + (nL - c1.x) * s, c1.y * (1.0 - s), c1.z * (1.0 - s));
    } else {
      pair = float3(c1.x + (c2.x - c1.x) * t, c1.y + (c2.y - c1.y) * t, c1.z + (c2.z - c1.z) * t);
    }
    // Near the triple point the pair fades to the e-weighted neutral over every slot (L6).
    float beta = sstep(0.0, uSelect.w, w1 / e1);
    float eSum = 0.0;
    float eL = 0.0;
    for (int i = 0; i < ${NODE_SLOTS}; i++) { eSum += e[i]; eL += e[i] * c[i].x; }
    float neutralL = eL / eSum;
    colour = float3(pair.x * beta + neutralL * (1.0 - beta), beta * pair.y, beta * pair.z);
  }

  float share = (1.0 - k) * (uWeight.w > 0.0 ? 1.0 - sstep(0.0, uWeight.w, k) : 1.0);
  half4 noise = uBlueNoise.eval(p);
  float ditherLevel = floor(float(noise.r) * 255.0 + 0.5);
  float grainLevel = floor(float(noise.g) * 255.0 + 0.5);
  float ditherValue = (2.0 * (ditherLevel + 0.5)) / 256.0 - 1.0;
  float grainValue = (2.0 * (grainLevel + 0.5)) / 256.0 - 1.0;
  float grain = region == 0.0 ? uNoise.x : uNoise.y;
  float L = ground.x + (colour.x - ground.x) * k + grain * grainValue + uNoise.z * ditherValue;
  float A = k * colour.y + share * ground.y;
  float B = k * colour.z + share * ground.z;

  float3 lab = float3(L, A, B);
  float3 lms = float3(dot(${row(OKLAB_TO_LMS, 0)}, lab), dot(${row(OKLAB_TO_LMS, 1)}, lab), dot(${row(OKLAB_TO_LMS, 2)}, lab));
  lms = lms * lms * lms;
  float3 linear = clamp(float3(dot(${row(LMS_TO_LINEAR_SRGB, 0)}, lms), dot(${row(LMS_TO_LINEAR_SRGB, 1)}, lms), dot(${row(LMS_TO_LINEAR_SRGB, 2)}, lms)), 0.0, 1.0);
  return half4(encode(linear.x), encode(linear.y), encode(linear.z), 1.0);
}
`;
