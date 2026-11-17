// A recording bound to its run (RA-47, the resilience audit of B8 at 16665fb): flashTrace.mts reads a screenrecord mp4 (or
// the frames decoded from one), and nothing in the file says which run, shot, size or density it belongs to. Checked here
// against the capture run's manifest (scripts/lab/capture.mjs writes it), so a recording reads only as what the run proved:
//   · the run passed (manifest.outcome): a shot refused after its proof still leaves its mp4 behind;
//   · the shot has a row (its last launch, which the record proof runs on) and exactly one record;
//   · the record's sha256 and size are the recording's: another shot's or run's mp4, or the same at another size, is not it;
//   · the px per dp the frames are read at is the run's: Android's float density for the row's device.density
//     (evidence.mts androidDensity, the reports' one helper), × the frame width ÷ the row's stage width (the app window,
//     the whole screen, UI-216), within 1e-6. Recordings are smaller than the screen (540 × 1170 on a 1080 × 2340 phone),
//     so the device's own density would make every cell twice as big and average its flashes away.
// Pure: no file is read here. Each problem names the manifest field it read.

import { validateManifest } from '../../lib/manifest.mjs';
import { androidDensity } from './evidence.mts';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fmt = (v) => String(Number(v.toFixed(6)));
const sizeText = (s) => `${s.width}x${s.height}`;
const PX_PER_DP_TOLERANCE = 1e-6;

/** The shot's last row and its index, or null. */
function lastRow(manifest, shot) {
  const rows = isObject(manifest) && Array.isArray(manifest.rows) ? manifest.rows : [];
  let at = -1;
  rows.forEach((r, i) => {
    if (isObject(r) && r.shot === shot && (at < 0 || r.repeat > rows[at].repeat)) at = i;
  });
  return at < 0 ? null : { row: rows[at], index: at };
}

/** The run's px per dp for frames of `size`, with how it was found; or the problem that stops it. */
function derive(manifest, shot, size) {
  const found = lastRow(manifest, shot);
  if (found === null) return { problem: `manifest.rows has no row for shot ${JSON.stringify(shot)}` };
  const { row, index } = found;
  const density = isObject(row.device) ? row.device.density : undefined;
  if (!(typeof density === 'number' && Number.isFinite(density) && density > 0)) {
    return { problem: `manifest.rows[${index}].device.density must be a dpi above 0, got ${JSON.stringify(density ?? null)}` };
  }
  const stageWidth = isObject(row.stage) ? row.stage.width : undefined;
  if (!(typeof stageWidth === 'number' && Number.isFinite(stageWidth) && stageWidth > 0)) {
    return { problem: `manifest.rows[${index}].stage.width must be a number above 0, got ${JSON.stringify(stageWidth ?? null)}` };
  }
  const k = androidDensity(density);
  return {
    pxPerDp: (k * size.width) / stageWidth,
    how: `manifest.rows[${index}].device.density ${density} dpi is Android's density ${fmt(k)}, × ${size.width} px frames ÷ manifest.rows[${index}].stage.width ${stageWidth}`,
  };
}

/** The run's px per dp for frames of `size` from the shot's row, or null when the row cannot give it. */
export function recordingPxPerDp(manifest, shot, size) {
  const d = derive(manifest, shot, size);
  return 'problem' in d ? null : d.pxPerDp;
}

/**
 * Every reason the recording is not the run's record of the shot, as sentences naming the manifest field; [] when bound.
 * @param {unknown} manifest the capture run's manifest
 * @param {{ shot: string, mp4Sha256: string, size: { width: number, height: number }, pxPerDp?: number }} recording
 *   pxPerDp: the px per dp the frames would be read at; omitted, it is not checked (the caller uses recordingPxPerDp).
 */
export function recordingProblems(manifest, { shot, mp4Sha256, size, pxPerDp }) {
  if (!isObject(manifest)) return ['the manifest is not an object'];
  // UI-240: the harness's validateManifest holds the top level before any field of it is read.
  const top = validateManifest(manifest);
  if (top.length > 0) return top.map((e) => `manifest.${e}`);
  if (manifest.outcome !== 'passed') {
    const why = typeof manifest.failure === 'string' && manifest.failure.length > 0 ? `: ${manifest.failure}` : '';
    return [`manifest.outcome is ${JSON.stringify(manifest.outcome ?? null)}, not "passed"${why}`];
  }
  const problems = [];
  const d = derive(manifest, shot, size);
  if ('problem' in d) problems.push(d.problem);
  const records = Array.isArray(manifest.records) ? manifest.records : [];
  const mine = records.map((r, i) => ({ r, i })).filter(({ r }) => isObject(r) && r.shot === shot);
  if (mine.length === 0) problems.push(`manifest.records has no record for shot ${JSON.stringify(shot)}`);
  else if (mine.length > 1) problems.push(`manifest.records has ${mine.length} records for shot ${JSON.stringify(shot)}: ${mine.map(({ i }) => `records[${i}]`).join(', ')}`);
  else {
    const { r, i } = mine[0];
    if (r.sha256 !== mp4Sha256) problems.push(`manifest.records[${i}].sha256 ${String(r.sha256)} is not the recording's ${mp4Sha256}`);
    const rs = isObject(r.size) ? r.size : {};
    if (rs.width !== size.width || rs.height !== size.height) problems.push(`manifest.records[${i}].size ${sizeText(rs)} is not the recording's ${sizeText(size)}`);
  }
  // The px per dp is the run's only for the run's recording: judged once everything above holds, never as an echo of it.
  if (problems.length === 0 && pxPerDp !== undefined && !(Math.abs(pxPerDp - d.pxPerDp) <= PX_PER_DP_TOLERANCE)) {
    problems.push(`px per dp ${fmt(pxPerDp)} is not the recording's ${fmt(d.pxPerDp)}: ${d.how}`);
  }
  return problems;
}
