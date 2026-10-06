import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BLUE_NOISE_SPEC, blueNoiseModule, voidAndCluster } from '../lib/blueNoise.mjs';
import { BLUE_NOISE } from '../../../src/design/v2/field/blueNoise.generated.ts';
import { blueNoiseLevel, blueNoiseRgba } from '../../../src/design/v2/field/blueNoise.ts';

// The field's static dither and grain (field.dither.pattern "blueNoise64.static", DSN-032): a 64×64
// tile made in-house by void-and-cluster (Ulichney 1993), so there is no licence question. One
// channel holds the dither, the other the grain, from two seeds. Each is a permutation of the 4096
// ranks, stored as 256 levels of 16 pixels each, so its mean is exactly zero once centred.

const APP_ROOT = path.resolve(__dirname, '../../..');
const GENERATED = path.join(APP_ROOT, 'src/design/v2/field/blueNoise.generated.ts');
const CLI = path.join(APP_ROOT, 'scripts/field/blueNoise.mjs');
const N = 64;

/** Fraction of the (DC-free) spectral energy at radial frequency ≤ `cutoff` cycles per tile. */
function lowFrequencyShare(values: ArrayLike<number>, cutoff: number): number {
  const mean = Array.from(values).reduce((s, v) => s + v, 0) / values.length;
  const cos = Array.from({ length: N }, (_, k) => Math.cos((-2 * Math.PI * k) / N));
  const sin = Array.from({ length: N }, (_, k) => Math.sin((-2 * Math.PI * k) / N));
  // A separable DFT: rows first (frequency u along x), then columns (frequency v along y).
  const rowRe = new Float64Array(N * N);
  const rowIm = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < N; u++) {
      let re = 0;
      let im = 0;
      for (let x = 0; x < N; x++) {
        const s = values[y * N + x] - mean;
        re += s * cos[(u * x) % N];
        im += s * sin[(u * x) % N];
      }
      rowRe[y * N + u] = re;
      rowIm[y * N + u] = im;
    }
  }
  let low = 0;
  let total = 0;
  for (let u = 0; u < N; u++) {
    for (let v = 0; v < N; v++) {
      let re = 0;
      let im = 0;
      for (let y = 0; y < N; y++) {
        const c = cos[(v * y) % N];
        const s = sin[(v * y) % N];
        re += rowRe[y * N + u] * c - rowIm[y * N + u] * s;
        im += rowRe[y * N + u] * s + rowIm[y * N + u] * c;
      }
      if (u === 0 && v === 0) continue;
      const power = re * re + im * im;
      const fu = u > N / 2 ? u - N : u;
      const fv = v > N / 2 ? v - N : v;
      total += power;
      if (Math.hypot(fu, fv) <= cutoff) low += power;
    }
  }
  return low / total;
}

describe('the field’s blue-noise tile', () => {
  it('is deterministic: the same seed gives the same ranks', () => {
    expect(Array.from(voidAndCluster(16, 7, 1.5))).toEqual(Array.from(voidAndCluster(16, 7, 1.5)));
  });

  it('ranks every pixel once: a permutation of 0..N²−1', () => {
    const ranks = Array.from(voidAndCluster(N, BLUE_NOISE_SPEC.seeds.dither, BLUE_NOISE_SPEC.sigma));
    expect(ranks.slice().sort((a, b) => a - b)).toEqual(Array.from({ length: N * N }, (_, i) => i));
  });

  it('has the spec the token names: 64×64, two seeds, σ 1.5', () => {
    expect(BLUE_NOISE_SPEC).toEqual({ size: 64, sigma: 1.5, seeds: { dither: 1, grain: 2 } });
    expect(BLUE_NOISE.size).toBe(64);
  });

  it.each(['dither', 'grain'] as const)('the %s channel has 16 pixels at each of the 256 levels, so its centred mean is exactly 0', (channel) => {
    const counts = new Array(256).fill(0);
    let sum = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const level = blueNoiseLevel(channel, x, y);
        counts[level] += 1;
        sum += 2 * ((level + 0.5) / 256) - 1;
      }
    }
    expect(counts.every((c) => c === 16)).toBe(true);
    expect(Math.abs(sum)).toBeLessThan(1e-9);
  });

  // White noise puts about 4.9% of its energy at radius ≤ 8 cycles; blue noise almost none.
  it.each(['dither', 'grain'] as const)('the %s channel is blue: under 1% of its energy below 8 cycles per tile', (channel) => {
    const values = Array.from({ length: N * N }, (_, i) => blueNoiseLevel(channel, i % N, Math.floor(i / N)));
    expect(lowFrequencyShare(values, 8)).toBeLessThan(0.01);
  });

  it('the two channels are independent (correlation under 0.05)', () => {
    const d = Array.from({ length: N * N }, (_, i) => blueNoiseLevel('dither', i % N, Math.floor(i / N)) - 127.5);
    const g = Array.from({ length: N * N }, (_, i) => blueNoiseLevel('grain', i % N, Math.floor(i / N)) - 127.5);
    const dot = d.reduce((s, v, i) => s + v * g[i], 0);
    const norm = Math.sqrt(d.reduce((s, v) => s + v * v, 0) * g.reduce((s, v) => s + v * v, 0));
    expect(Math.abs(dot / norm)).toBeLessThan(0.05);
  });

  it('tiles: a level wraps every 64 pixels in x and y', () => {
    expect(blueNoiseLevel('dither', 3 + 64, 5 + 128)).toBe(blueNoiseLevel('dither', 3, 5));
    expect(blueNoiseLevel('grain', -1, -64)).toBe(blueNoiseLevel('grain', 63, 0));
  });

  it('packs RGBA for an image shader: R the dither, G the grain, B 0, A 255', () => {
    const rgba = blueNoiseRgba();
    expect(rgba).toHaveLength(N * N * 4);
    expect([rgba[(5 * N + 3) * 4], rgba[(5 * N + 3) * 4 + 1], rgba[(5 * N + 3) * 4 + 2], rgba[(5 * N + 3) * 4 + 3]]).toEqual([
      blueNoiseLevel('dither', 3, 5),
      blueNoiseLevel('grain', 3, 5),
      0,
      255,
    ]);
  });
});

describe('blueNoise.generated.ts is fresh', () => {
  it('is byte for byte what the generator makes', () => {
    expect(fs.readFileSync(GENERATED, 'utf8')).toBe(blueNoiseModule());
  });

  it('the CLI’s --check passes on the committed module', () => {
    const r = spawnSync(process.execPath, [CLI, '--check'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('is fresh');
  });
});
