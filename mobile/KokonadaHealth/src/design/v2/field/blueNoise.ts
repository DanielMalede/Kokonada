// The field's static blue-noise tile, decoded (blueNoise.generated.ts, made by
// scripts/field/blueNoise.mjs). The shader samples it as an image: R the dither, G the grain.
// The TypeScript field model reads the same levels, so the two agree pixel for pixel.

import { BLUE_NOISE } from './blueNoise.generated.ts';

export type BlueNoiseChannel = 'dither' | 'grain';

export const BLUE_NOISE_SIZE = BLUE_NOISE.size;

const decode = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
};

const LEVELS: Record<BlueNoiseChannel, Uint8Array> = {
  dither: decode(BLUE_NOISE.dither),
  grain: decode(BLUE_NOISE.grain),
};

/** The level (0..255) at pixel (x, y); the tile repeats every 64 pixels both ways. */
export function blueNoiseLevel(channel: BlueNoiseChannel, x: number, y: number): number {
  const n = BLUE_NOISE_SIZE;
  const wx = ((Math.floor(x) % n) + n) % n;
  const wy = ((Math.floor(y) % n) + n) % n;
  return LEVELS[channel][wy * n + wx];
}

/** The centred value in (−1, 1): 2·(level + 0.5)/256 − 1, the same expression the shader uses. */
export function blueNoiseValue(channel: BlueNoiseChannel, x: number, y: number): number {
  return (2 * (blueNoiseLevel(channel, x, y) + 0.5)) / 256 - 1;
}

/** RGBA bytes for the image the shader samples: R the dither, G the grain, B 0, A 255. */
export function blueNoiseRgba(): Uint8Array {
  const n = BLUE_NOISE_SIZE;
  const out = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    out[4 * i] = LEVELS.dither[i];
    out[4 * i + 1] = LEVELS.grain[i];
    out[4 * i + 2] = 0;
    out[4 * i + 3] = 255;
  }
  return out;
}
