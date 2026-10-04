// Images for the capture harness (OPS-100): raw screen grabs, the app region, its hash, and PNG.
//
// A grab is read RAW (`adb exec-out screencap`, no -p), as the display composed it. AOSP's screencap
// writes a header before the pixels: width, height and pixel format as little-endian u32, and since
// Android 9 a fourth u32, the colour space (0 unknown, 1 sRGB, 2 Display P3). Rows are written
// tightly packed. A grab that is not 8-bit sRGB is refused: sampled colours and contrast ratios
// would be in the wrong space. (The constants are from AOSP's screencap source; their reading on
// the S22+ is part of the device smoke test.)
//
// PNG goes through the locked canvaskit-wasm, so no image library is installed.

import crypto from 'node:crypto';
import CanvasKitInit from 'canvaskit-wasm/bin/full/canvaskit.js';

export const SCREENCAP = {
  FORMAT: { RGBA_8888: 1, RGBX_8888: 2, RGB_888: 3, RGB_565: 4, BGRA_8888: 5, RGBA_FP16: 22, RGBA_1010102: 43 },
  COLOR_SPACE: { UNKNOWN: 0, SRGB: 1, DISPLAY_P3: 2 },
};
const FORMAT_NAME = Object.fromEntries(Object.entries(SCREENCAP.FORMAT).map(([k, v]) => [v, k]));
const BYTES_PER_PIXEL = { 1: 4, 2: 4, 3: 3, 4: 2, 5: 4, 22: 8, 43: 4 };
const COLOR_SPACE_NAME = { 0: 'unknown', 1: 'sRGB', 2: 'Display P3' };

/** A raw screencap: { width, height, format, colorSpace, rgba } with tightly packed 8-bit RGBA. */
export function parseRawScreencap(buf) {
  if (buf.length < 12) throw new Error(`screencap: ${buf.length} bytes is not even a header`);
  const width = buf.readUInt32LE(0);
  const height = buf.readUInt32LE(4);
  const code = buf.readUInt32LE(8);
  const bpp = BYTES_PER_PIXEL[code];
  if (!bpp) throw new Error(`screencap: unknown pixel format ${code}`);
  const body = width * height * bpp;
  let headerSize;
  if (buf.length === 16 + body) headerSize = 16;
  else if (buf.length === 12 + body) headerSize = 12;
  else throw new Error(`screencap: size ${buf.length} does not match ${width}x${height} in format ${FORMAT_NAME[code]}`);

  const format = FORMAT_NAME[code];
  if (!['RGBA_8888', 'RGBX_8888', 'BGRA_8888'].includes(format)) {
    throw new Error(`screencap: pixel format ${format} is not 8-bit RGBA, so it cannot be sampled as sRGB`);
  }
  const colorCode = headerSize === 16 ? buf.readUInt32LE(12) : null;
  const colorSpace = colorCode === null ? 'none' : (COLOR_SPACE_NAME[colorCode] ?? `code ${colorCode}`);

  const pixels = buf.subarray(headerSize);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const s = i * 4;
    if (format === 'BGRA_8888') rgba.set([pixels[s + 2], pixels[s + 1], pixels[s], pixels[s + 3]], s);
    else rgba.set([pixels[s], pixels[s + 1], pixels[s + 2], format === 'RGBX_8888' ? 255 : pixels[s + 3]], s);
  }
  return { width, height, format, colorSpace, rgba };
}

/** Throws unless the grab says it is sRGB. */
export function requireSrgb(frame) {
  if (frame.colorSpace !== 'sRGB') {
    const why = frame.colorSpace === 'none' ? 'the header carries no colour space (Android 8 or older)' : `it is ${frame.colorSpace}`;
    throw new Error(`screencap is not sRGB: ${why}. Set the screen mode to Natural (sRGB) and capture again.`);
  }
  return frame;
}

const isEmpty = (r) => r.width <= 0 || r.height <= 0;

/**
 * The app region: the screen minus the system bars. Each bar removes the band along the edge it is
 * attached to (status bar and cutout at the top, navigation bar at the bottom or on a side).
 */
export function appRegion(screen, bars) {
  let top = 0;
  let bottom = screen.height;
  let left = 0;
  let right = screen.width;
  for (const b of bars) {
    if (isEmpty(b)) continue;
    const horizontal = b.width >= b.height;
    if (horizontal && b.y <= 0) top = Math.max(top, b.y + b.height);
    else if (horizontal && b.y + b.height >= screen.height) bottom = Math.min(bottom, b.y);
    else if (b.x <= 0) left = Math.max(left, b.x + b.width);
    else if (b.x + b.width >= screen.width) right = Math.min(right, b.x);
  }
  const region = { x: left, y: top, width: right - left, height: bottom - top };
  if (isEmpty(region)) throw new Error('the system bars leave no app region');
  return region;
}

/** The RGBA bytes of an integer rect inside the frame, row by row. */
export function cropRegion(frame, rect) {
  const { x, y, width, height } = rect;
  if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
      || x + width > frame.width || y + height > frame.height) {
    throw new Error(`region ${JSON.stringify(rect)} is outside the ${frame.width}x${frame.height} frame or not whole pixels`);
  }
  const out = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * frame.width + x) * 4;
    out.set(frame.rgba.subarray(from, from + width * 4), row * width * 4);
  }
  return out;
}

/** sha256 of the region's size and pixels. Pixels outside it, the system bars, cannot change it. */
export function regionHash(frame, rect) {
  return crypto.createHash('sha256').update(`${rect.width}x${rect.height}\n`).update(cropRegion(frame, rect)).digest('hex');
}

let canvasKit = null;
const loadCanvasKit = () => {
  canvasKit = canvasKit ?? CanvasKitInit({});
  return canvasKit;
};

/** Lossless PNG of 8-bit RGBA pixels. */
export async function encodePng({ width, height, rgba }) {
  const ck = await loadCanvasKit();
  const info = { width, height, alphaType: ck.AlphaType.Unpremul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB };
  const image = ck.MakeImage(info, rgba, width * 4);
  if (!image) throw new Error(`PNG: CanvasKit could not make a ${width}x${height} image`);
  try {
    const bytes = image.encodeToBytes(ck.ImageFormat.PNG, 100);
    if (!bytes) throw new Error('PNG: CanvasKit could not encode the image');
    return Buffer.from(bytes);
  } finally {
    image.delete();
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The 8-bit RGBA pixels of a PNG. */
export async function decodePng(buf) {
  if (buf.length < 8 || !Buffer.from(buf.subarray(0, 8)).equals(PNG_SIGNATURE)) throw new Error('not a PNG: no PNG signature');
  const ck = await loadCanvasKit();
  const image = ck.MakeImageFromEncoded(new Uint8Array(buf));
  if (!image) throw new Error('PNG: CanvasKit could not decode it');
  try {
    const width = image.width();
    const height = image.height();
    const pixels = image.readPixels(0, 0, {
      width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB,
    });
    if (!pixels) throw new Error('PNG: CanvasKit could not read the pixels back');
    return { width, height, rgba: new Uint8Array(pixels) };
  } finally {
    image.delete();
  }
}
