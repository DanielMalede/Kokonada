// A minimal zip reader with no dependencies, for the Design Lab exclusion scan (MB-084). It reads
// what an upload is: an APK, an AAB, a bundletool .apks set. Stored and deflated entries only.
// Anything else (zip64, encryption, another compression method, a truncated entry) THROWS: an
// archive the scan cannot read must never be reported clean.

import zlib from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_COMMENT = 0xffff;

/** Whether the bytes open with a zip local file header. */
export const isZip = (buf) => buf.length >= 4 && buf.readUInt32LE(0) === LOCAL_FILE_HEADER;

/** Every entry of a zip archive, decompressed: [{ name, data }], in central-directory order. */
export function readZipEntries(buf) {
  const fail = (why) => { throw new Error(`not a readable zip archive: ${why}`); };

  let end = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - MAX_COMMENT; i -= 1) {
    if (buf.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) { end = i; break; }
  }
  if (end < 0) fail('no end-of-central-directory record');

  const count = buf.readUInt16LE(end + 10);
  const directorySize = buf.readUInt32LE(end + 12);
  const directoryOffset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff) fail('zip64 is not supported');
  if (directoryOffset + directorySize > end) fail('the central directory is out of range');

  const entries = [];
  let p = directoryOffset;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > end || buf.readUInt32LE(p) !== CENTRAL_FILE_HEADER) fail(`central directory entry ${n} is damaged`);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;

    if (flags & 1) fail(`${name} is encrypted`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) fail(`${name} needs zip64`);
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) fail(`${name} has no local header`);

    // The local header's own name and extra lengths: aligners (zipalign, AGP) pad the local extra
    // field, so it need not match the central directory's.
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compressedSize);
    if (raw.length !== compressedSize) fail(`${name} is truncated`);

    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else fail(`${name} uses compression method ${method}`);
    if (data.length !== size) fail(`${name} inflated to ${data.length} bytes, expected ${size}`);
    entries.push({ name, data });
  }
  return entries;
}
