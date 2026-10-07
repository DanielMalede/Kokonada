import * as law from '../fieldLaw.ts';
import { NODE, NODE_SLOTS, QUIET_SLOTS, SHADOW_SLOTS, inertNode, inertShadow, type FieldFrame, type FieldNodeFrame } from '../fieldLaw.ts';
import { FIELD_UNIFORMS, FIELD_UNIFORM_FLOATS, packFrame } from '../uniforms.ts';

// The uniform layout is the contract between the uniform builder (TypeScript) and the shader
// (SkSL): fieldShader.skia.test.ts pins it to the compiled effect's own names, sizes and slots.

const grey = { L: 0.5, a: 0, b: 0 };
const node = (id: number, overrides: Partial<FieldNodeFrame> = {}): FieldNodeFrame => ({
  id,
  fade: 1,
  centre: [0.1, 0.2],
  radius: 0.3,
  field: { L: 0.6, a: 0.01, b: 0.02 },
  halo: { L: 0.7, a: 0.03, b: 0.04 },
  bead: [0.5, 0.6],
  ...overrides,
});
const frame = (overrides: Partial<FieldFrame> = {}): FieldFrame => ({
  centrePx: [10, 20],
  radiusPx: 30,
  ringInner: 0.8,
  moatOuter: 1.1,
  moatFeather: 0.2,
  beadRadius: 0.05,
  haloRadius: 0.15,
  mask: { outside: 1, face: 0.5, ring: 0 },
  grounds: { outside: { L: 0.1, a: 0.2, b: 0.3 }, face: { L: 0.4, a: 0.5, b: 0.6 }, ring: { L: 0.7, a: 0.8, b: 0.9 } },
  vignette: -0.12,
  centreLift: 0.03,
  kField: 0.6,
  kMax: 0.85,
  haloPeak: 0.45,
  kp: 0.2,
  warp: { amount: 0.3, orbit: 0.6, cos: 0.8, sin: 0.6, octaves: 3 },
  shimmer: { cos: 0.99, sin: 0.1 },
  lambda: 1000,
  restIntenseWaypoint: true,
  grain: { inside: 0.012, ground: 0.02 },
  dither: 1 / 255,
  quiet: { rects: [{ cx: 11, cy: 12, hx: 13, hy: 14 }, { cx: 21, cy: 22, hx: 23, hy: 24 }], grow: 8, feather: 40 },
  shadows: [{ offset: -0.02, blur: 0.05, strength: 0.18, mode: -1 }, inertShadow()],
  nodes: [node(NODE.J), node(NODE.C), node(NODE.I, { bead: null }), node(NODE.R0, { fade: 0 }), node(NODE.R0, { fade: 0.5 }), inertNode()],
  ...overrides,
});

describe('the field uniform layout', () => {
  // Architect re-rule §2 and the designer's final ruling (1): one pool of six node slots, with no
  // fixed live/shared split; each slot is 14 floats in 4 declarations.
  // With the quiet zones (six rects and their parameters) and the two plate shadows (architect
  // re-rule §2): 157 floats in 46 declarations.
  it('has one pool of six node slots, no live/shared split, six quiet rects and two shadows: 157 floats in 46 declarations', () => {
    expect(NODE_SLOTS).toBe(6);
    expect([QUIET_SLOTS, SHADOW_SLOTS]).toEqual([6, 2]);
    expect(Object.keys(law).filter((k) => /LIVE_SLOTS|SHARED_SLOTS/.test(k))).toEqual([]);
    expect(FIELD_UNIFORMS).toHaveLength(13 + QUIET_SLOTS + 1 + SHADOW_SLOTS + 4 * NODE_SLOTS);
    expect(FIELD_UNIFORMS.length).toBe(46);
    expect(FIELD_UNIFORM_FLOATS).toBe(38 + 4 * QUIET_SLOTS + 3 + 4 * SHADOW_SLOTS + 14 * NODE_SLOTS);
    expect(FIELD_UNIFORM_FLOATS).toBe(157);
    expect(FIELD_UNIFORMS.slice(-4).map((u) => u.name)).toEqual(['uNode5', 'uNode5Bead', 'uNode5Field', 'uNode5Halo']);
  });

  // An unused slot is inert: no fade, no lobe, no halo, and a finite colour, so 0·c is never NaN.
  it('an inert node: fade 0, no lobe, no halo, finite colours', () => {
    const n = inertNode();
    expect(n).toEqual({ id: NODE.R0, fade: 0, centre: [0, 0], radius: 0, field: { L: 0, a: 0, b: 0 }, halo: { L: 0, a: 0, b: 0 }, bead: null });
    expect(inertNode()).not.toBe(n);
  });

  it('names every uniform once, in order, with its float count', () => {
    const names = FIELD_UNIFORMS.map((u) => u.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.slice(0, 22)).toEqual([
      'uGeom', 'uGeom2', 'uMask', 'uGroundOutside', 'uGroundFace', 'uGroundRing', 'uFace', 'uWeight', 'uWarp', 'uOctaves',
      'uShimmer', 'uSelect', 'uNoise',
      'uQuiet0', 'uQuiet1', 'uQuiet2', 'uQuiet3', 'uQuiet4', 'uQuiet5', 'uQuietParams', 'uShadow0', 'uShadow1',
    ]);
    for (let k = 0; k < NODE_SLOTS; k++) {
      expect(names).toEqual(expect.arrayContaining([`uNode${k}`, `uNode${k}Bead`, `uNode${k}Field`, `uNode${k}Halo`]));
    }
    expect(FIELD_UNIFORM_FLOATS).toBe(FIELD_UNIFORMS.reduce((s, u) => s + u.floats, 0));
  });

  it('packs a frame in that order', () => {
    const packed = packFrame(frame());
    expect(packed).toHaveLength(FIELD_UNIFORM_FLOATS);
    expect(packed.slice(0, 8)).toEqual([10, 20, 30, 0.8, 1.1, 0.2, 0.05, 0.15]);
    const at = (name: string) => {
      let offset = 0;
      for (const u of FIELD_UNIFORMS) {
        if (u.name === name) return packed.slice(offset, offset + u.floats);
        offset += u.floats;
      }
      throw new Error(name);
    };
    expect(at('uMask')).toEqual([1, 0.5, 0]);
    expect(at('uGroundRing')).toEqual([0.7, 0.8, 0.9]);
    expect(at('uWeight')).toEqual([0.6, 0.85, 0.45, 0.2]);
    expect(at('uWarp')).toEqual([0.3, 0.6, 0.8, 0.6]);
    expect(at('uOctaves')).toEqual([3]);
    expect(at('uSelect')).toEqual([1000, 1]);
    expect(at('uNode0')).toEqual([0.1, 0.2, 0.3, 1]);
    expect(at('uNode0Bead')).toEqual([0.5, 0.6, 1, NODE.J]);
    expect(at('uNode2Bead')).toEqual([0, 0, 0, NODE.I]); // a rest lobe: no halo
    expect(at('uNode4')).toEqual([0.1, 0.2, 0.3, 0.5]);
    expect(at('uNode5')).toEqual([0, 0, 0, 0]);
    expect(at('uNode5Bead')).toEqual([0, 0, 0, NODE.R0]);
    expect(at('uNode1Field')).toEqual([0.6, 0.01, 0.02]);
    expect(at('uNode1Halo')).toEqual([0.7, 0.03, 0.04]);
    // Quiet rects: centre and half-size in render px; unused slots are zeros, inert through count only.
    expect(at('uQuiet0')).toEqual([11, 12, 13, 14]);
    expect(at('uQuiet1')).toEqual([21, 22, 23, 24]);
    for (const k of [2, 3, 4, 5]) expect(at(`uQuiet${k}`)).toEqual([0, 0, 0, 0]);
    expect(at('uQuietParams')).toEqual([8, 40, 2]);
    expect(at('uShadow0')).toEqual([-0.02, 0.05, 0.18, -1]);
    expect(at('uShadow1')).toEqual([0, 0, 0, 0]);
  });

  it('refuses a frame that does not fill every node slot, or that holds more than six quiet rects or not two shadows', () => {
    expect(() => packFrame(frame({ nodes: [node(NODE.J)] }))).toThrow(RangeError);
    const seven = Array.from({ length: 7 }, () => ({ cx: 1, cy: 1, hx: 1, hy: 1 }));
    expect(() => packFrame(frame({ quiet: { rects: seven, grow: 8, feather: 0 } }))).toThrow(RangeError);
    expect(() => packFrame(frame({ shadows: [inertShadow()] }))).toThrow(RangeError);
  });

  // A NaN or an Infinity reaching a uniform makes the whole field black or garbage on the GPU.
  it('never packs a non-finite number: NaN and ±Infinity become 0', () => {
    const bad = frame({ kField: NaN, warp: { amount: Infinity, orbit: 0.6, cos: NaN, sin: -Infinity, octaves: 3 } });
    const packed = packFrame(bad);
    expect(packed.every(Number.isFinite)).toBe(true);
    let offset = 0;
    const slots: Record<string, number> = {};
    for (const u of FIELD_UNIFORMS) {
      slots[u.name] = offset;
      offset += u.floats;
    }
    expect(packed[slots.uWeight]).toBe(0);
    expect(packed.slice(slots.uWarp, slots.uWarp + 4)).toEqual([0, 0.6, 0, 0]);
    expect(packFrame(frame({ grounds: { outside: grey, face: grey, ring: grey } })).every(Number.isFinite)).toBe(true);
  });
});
