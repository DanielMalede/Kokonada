/// <reference types="node" />
import { appRegion, cropRegion, decodePng, encodePng, parseRawScreencap, regionHash, requireSrgb, SCREENCAP } from '../lib/png.mjs';

// OPS-100. The capture harness reads each grab RAW over adb (`adb exec-out screencap`, no -p), so
// it sees exactly what the display composed, plus the header screencap writes before the pixels:
//   width u32 · height u32 · pixel format u32 · colour space u32  (little-endian, Android 9+)
// The colour space must be sRGB, or every sampled colour and contrast ratio is in the wrong space.
// Crops are kept as PNG through the locked canvaskit-wasm, and must round-trip without loss.

type Frame = { width: number; height: number; rgba: Uint8Array };

function raw(width: number, height: number, format: number, colorSpace: number | null, pixel: (x: number, y: number) => number[]) {
  const bpp = format === SCREENCAP.FORMAT.RGB_565 ? 2 : 4;
  const header = Buffer.alloc(colorSpace === null ? 12 : 16);
  header.writeUInt32LE(width, 0);
  header.writeUInt32LE(height, 4);
  header.writeUInt32LE(format, 8);
  if (colorSpace !== null) header.writeUInt32LE(colorSpace, 12);
  const body = Buffer.alloc(width * height * bpp);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const p = pixel(x, y);
    for (let c = 0; c < bpp; c += 1) body[(y * width + x) * bpp + c] = p[c] ?? 0;
  }
  return Buffer.concat([header, body]);
}

describe('parseRawScreencap', () => {
  it('reads the header and the RGBA pixels of an sRGB grab', () => {
    const f = parseRawScreencap(raw(3, 2, SCREENCAP.FORMAT.RGBA_8888, SCREENCAP.COLOR_SPACE.SRGB, (x, y) => [x, y, 7, 255]));
    expect([f.width, f.height, f.format, f.colorSpace]).toEqual([3, 2, 'RGBA_8888', 'sRGB']);
    expect(Array.from(f.rgba.slice(0, 8))).toEqual([0, 0, 7, 255, 1, 0, 7, 255]);
    expect(f.rgba.length).toBe(3 * 2 * 4);
  });

  it('reads RGBX as opaque, and BGRA by swapping to RGBA', () => {
    const x = parseRawScreencap(raw(1, 1, SCREENCAP.FORMAT.RGBX_8888, SCREENCAP.COLOR_SPACE.SRGB, () => [10, 20, 30, 0]));
    expect(Array.from(x.rgba)).toEqual([10, 20, 30, 255]);
    const b = parseRawScreencap(raw(1, 1, SCREENCAP.FORMAT.BGRA_8888, SCREENCAP.COLOR_SPACE.SRGB, () => [30, 20, 10, 255]));
    expect(Array.from(b.rgba)).toEqual([10, 20, 30, 255]);
  });

  it('names the colour space it was told, Display P3 and unknown included', () => {
    expect(parseRawScreencap(raw(1, 1, 1, SCREENCAP.COLOR_SPACE.DISPLAY_P3, () => [0, 0, 0, 255])).colorSpace).toBe('Display P3');
    expect(parseRawScreencap(raw(1, 1, 1, SCREENCAP.COLOR_SPACE.UNKNOWN, () => [0, 0, 0, 255])).colorSpace).toBe('unknown');
  });

  it('refuses a grab it cannot read exactly: a short body, extra bytes, an unsupported format', () => {
    const ok = raw(2, 2, 1, 1, () => [1, 2, 3, 255]);
    expect(() => parseRawScreencap(ok.subarray(0, ok.length - 1))).toThrow(/size/);
    expect(() => parseRawScreencap(Buffer.concat([ok, Buffer.alloc(3)]))).toThrow(/size/);
    expect(() => parseRawScreencap(raw(2, 2, SCREENCAP.FORMAT.RGB_565, 1, () => [0, 0]))).toThrow(/format/);
    expect(() => parseRawScreencap(Buffer.alloc(8))).toThrow(/header/);
  });
});

describe('requireSrgb (a capture in the wrong colour space fails)', () => {
  it('passes sRGB', () => {
    expect(() => requireSrgb(parseRawScreencap(raw(1, 1, 1, SCREENCAP.COLOR_SPACE.SRGB, () => [0, 0, 0, 255])))).not.toThrow();
  });

  it.each([
    ['Display P3 (a wide-gamut screen mode)', SCREENCAP.COLOR_SPACE.DISPLAY_P3],
    ['unknown', SCREENCAP.COLOR_SPACE.UNKNOWN],
  ])('fails %s', (_label, colorSpace) => {
    expect(() => requireSrgb(parseRawScreencap(raw(1, 1, 1, colorSpace, () => [0, 0, 0, 255])))).toThrow(/sRGB/);
  });

  it('fails a pre-Android-9 header, which carries no colour space at all', () => {
    expect(() => requireSrgb(parseRawScreencap(raw(1, 1, 1, null, () => [0, 0, 0, 255])))).toThrow(/sRGB/);
  });
});

describe('the app region and its hash', () => {
  const W = 10;
  const H = 20;
  const frame = (paint: (x: number, y: number) => number[]): Frame => {
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) rgba.set(paint(x, y), (y * W + x) * 4);
    return { width: W, height: H, rgba };
  };
  const bars = [{ x: 0, y: 0, width: W, height: 2 }, { x: 0, y: 17, width: W, height: 3 }]; // status and navigation
  const region = appRegion({ width: W, height: H }, bars);

  it('is the screen minus the system bars', () => {
    expect(region).toEqual({ x: 0, y: 2, width: W, height: 15 });
  });

  it('ignores the bars: a new clock in the status bar or a nav-bar change keeps the hash', () => {
    const base = frame((x, y) => [x, y, 1, 255]);
    const clockTicked = frame((x, y) => (y < 2 ? [99, 99, 99, 255] : [x, y, 1, 255]));
    const navChanged = frame((x, y) => (y >= 17 ? [5, 5, 5, 255] : [x, y, 1, 255]));
    expect(regionHash(clockTicked, region)).toBe(regionHash(base, region));
    expect(regionHash(navChanged, region)).toBe(regionHash(base, region));
  });

  it('sees any change inside the app region, down to one channel of one pixel', () => {
    const base = frame((x, y) => [x, y, 1, 255]);
    const onePixel = frame((x, y) => (x === 4 && y === 9 ? [x, y, 2, 255] : [x, y, 1, 255]));
    expect(regionHash(onePixel, region)).not.toBe(regionHash(base, region));
    expect(regionHash(base, region)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('crops exactly the region, row by row', () => {
    const base = frame((x, y) => [x, y, 0, 255]);
    const crop = cropRegion(base, { x: 1, y: 2, width: 2, height: 2 });
    expect(Array.from(crop)).toEqual([1, 2, 0, 255, 2, 2, 0, 255, 1, 3, 0, 255, 2, 3, 0, 255]);
  });

  it('refuses a region outside the frame, and bars that leave no app region', () => {
    expect(() => cropRegion(frame(() => [0, 0, 0, 255]), { x: 5, y: 15, width: 6, height: 1 })).toThrow(/outside/);
    expect(() => appRegion({ width: W, height: H }, [{ x: 0, y: 0, width: W, height: H }])).toThrow(/no app region/);
  });
});

describe('PNG through canvaskit-wasm', () => {
  it('round-trips every 8-bit value of every channel without loss (opaque, as a screen grab is)', async () => {
    const width = 256;
    const height = 3;
    const rgba = new Uint8Array(width * height * 4);
    for (let x = 0; x < width; x += 1) {
      rgba.set([x, 255 - x, (x * 7) % 256, 255], x * 4);
      rgba.set([(x * 13) % 256, x, 255 - x, 255], (width + x) * 4);
      rgba.set([255 - x, (x * 31) % 256, x, 255], (2 * width + x) * 4);
    }
    const png = await encodePng({ width, height, rgba });
    expect(Array.from(png.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]); // "PNG"
    const back = await decodePng(png);
    expect([back.width, back.height]).toEqual([width, height]);
    expect(Buffer.from(back.rgba).equals(Buffer.from(rgba))).toBe(true);
  });

  it('refuses bytes that are not an image', async () => {
    await expect(decodePng(Buffer.from('not a png'))).rejects.toThrow(/PNG/);
  });
});
