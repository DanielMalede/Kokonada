// renderIcons — rasterises the Aurora Seed SVGs (buildBrandSvg) into every launcher asset:
//   • iOS single-1024 AppIcon with Any / Dark / Tinted appearances + Contents.json
//   • Android adaptive foreground PNG per density, an abyss background drawable, a white
//     monochrome (themed) VectorDrawable, the anydpi adaptive-icon XML, and legacy
//     ic_launcher / ic_launcher_round PNGs per density.
// The PURE generators (XML/JSON strings) are unit-tested; main() does the real sharp render
// and SELF-VERIFIES every output's dimensions (real evidence, printed as a manifest).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CENTER, monochrome, treatments } from '../../src/design/brandMark.geometry.ts';
import { iconSvg, foregroundSvg, tintedSvg } from './buildBrandSvg.mjs';

// sharp is a native module — imported dynamically inside main() so that importing this file
// for its PURE generators (the unit tests) never loads the native binary.
let sharp;

// This build script is run FROM the package root: `node scripts/brand/renderIcons.mjs`.
// (import.meta is avoided so the module also loads under jest's CJS transform for unit tests.)
const ROOT = process.cwd(); // mobile/KokonadaHealth
const ANDROID_RES = path.join(ROOT, 'android/app/src/main/res');
const IOS_APPICON = path.join(ROOT, 'ios/KokonadaHealth/Images.xcassets/AppIcon.appiconset');

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const FOREGROUND_DP = 108; // adaptive icon layer
const LEGACY_DP = 48; // pre-API-26 launcher icon

// ── PURE GENERATORS (unit-tested) ────────────────────────────────────────────

export function adaptiveIconXml() {
  return `<?xml version="1.0" encoding="utf-8"?>\n`
    + `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n`
    + `    <background android:drawable="@drawable/ic_launcher_background"/>\n`
    + `    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n`
    + `    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>\n`
    + `</adaptive-icon>\n`;
}

export function backgroundDrawableXml() {
  return `<?xml version="1.0" encoding="utf-8"?>\n`
    + `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n`
    + `    <solid android:color="${treatments.dark.bg}"/>\n`
    + `</shape>\n`;
}

// A circle as VectorDrawable pathData (two half-arcs), in a `viewport`-unit box.
function circlePath(r, viewport) {
  const cx = +(CENTER * viewport).toFixed(3);
  const rr = +(r * viewport).toFixed(3);
  const d = +(rr * 2).toFixed(3);
  return `M${+(cx - rr).toFixed(3)},${cx}a${rr},${rr} 0 1,0 ${d},0a${rr},${rr} 0 1,0 ${-d},0`;
}

export function monochromeVectorXml(viewport = FOREGROUND_DP) {
  const sw = (frac) => +(frac * viewport).toFixed(3);
  const ring = (r, w) =>
    `    <path android:pathData="${circlePath(r, viewport)}" android:fillColor="#00000000" android:strokeColor="${monochrome.color}" android:strokeWidth="${sw(w)}"/>\n`;
  return `<?xml version="1.0" encoding="utf-8"?>\n`
    + `<vector xmlns:android="http://schemas.android.com/apk/res/android"\n`
    + `    android:width="${viewport}dp" android:height="${viewport}dp"\n`
    + `    android:viewportWidth="${viewport}" android:viewportHeight="${viewport}">\n`
    + ring(monochrome.ring2.r, monochrome.ring2.sw)
    + ring(monochrome.ring1.r, monochrome.ring1.sw)
    + `    <path android:pathData="${circlePath(monochrome.core.r, viewport)}" android:fillColor="${monochrome.color}"/>\n`
    + `</vector>\n`;
}

export function iosContentsJson() {
  const img = (filename, appearance) => ({
    ...(appearance ? { appearances: [{ appearance: 'luminosity', value: appearance }] } : {}),
    filename,
    idiom: 'universal',
    platform: 'ios',
    size: '1024x1024',
  });
  return {
    images: [
      img('Icon-1024-any.png'),
      img('Icon-1024-dark.png', 'dark'),
      img('Icon-1024-tinted.png', 'tinted'),
    ],
    info: { author: 'xcode', version: 1 },
  };
}

// ── REAL RENDER (main) ───────────────────────────────────────────────────────

async function renderPng(svg, size, outFile, { round = false } = {}) {
  let img = sharp(Buffer.from(svg)).resize(size, size);
  if (round) {
    const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`;
    img = sharp(await img.png().toBuffer()).composite([{ input: Buffer.from(mask), blend: 'dest-in' }]);
  }
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await img.png().toFile(outFile);
  const meta = await sharp(outFile).metadata();
  if (meta.width !== size || meta.height !== size) {
    throw new Error(`dimension mismatch for ${outFile}: got ${meta.width}x${meta.height}, want ${size}x${size}`);
  }
  return { file: path.relative(ROOT, outFile), size: `${meta.width}x${meta.height}` };
}

async function main() {
  sharp = (await import('sharp')).default;
  const manifest = [];

  // iOS — single 1024 with Any/Dark/Tinted appearances + Contents.json
  await fs.mkdir(IOS_APPICON, { recursive: true });
  manifest.push(await renderPng(iconSvg('dark', 1024), 1024, path.join(IOS_APPICON, 'Icon-1024-any.png')));
  manifest.push(await renderPng(iconSvg('dark', 1024), 1024, path.join(IOS_APPICON, 'Icon-1024-dark.png')));
  manifest.push(await renderPng(tintedSvg(1024), 1024, path.join(IOS_APPICON, 'Icon-1024-tinted.png')));
  await fs.writeFile(path.join(IOS_APPICON, 'Contents.json'), JSON.stringify(iosContentsJson(), null, 2) + '\n');

  // Android adaptive foreground + legacy launcher, per density
  for (const [dpi, scale] of Object.entries(DENSITIES)) {
    const mipmap = path.join(ANDROID_RES, `mipmap-${dpi}`);
    const fg = Math.round(FOREGROUND_DP * scale);
    const lg = Math.round(LEGACY_DP * scale);
    manifest.push(await renderPng(foregroundSvg(fg), fg, path.join(mipmap, 'ic_launcher_foreground.png')));
    manifest.push(await renderPng(iconSvg('dark', lg), lg, path.join(mipmap, 'ic_launcher.png')));
    manifest.push(await renderPng(iconSvg('dark', lg), lg, path.join(mipmap, 'ic_launcher_round.png'), { round: true }));
  }

  // Android XML layers
  const anydpi = path.join(ANDROID_RES, 'mipmap-anydpi-v26');
  const drawable = path.join(ANDROID_RES, 'drawable');
  await fs.mkdir(anydpi, { recursive: true });
  await fs.mkdir(drawable, { recursive: true });
  await fs.writeFile(path.join(anydpi, 'ic_launcher.xml'), adaptiveIconXml());
  await fs.writeFile(path.join(anydpi, 'ic_launcher_round.xml'), adaptiveIconXml());
  await fs.writeFile(path.join(drawable, 'ic_launcher_background.xml'), backgroundDrawableXml());
  await fs.writeFile(path.join(drawable, 'ic_launcher_monochrome.xml'), monochromeVectorXml());

  console.log(`RENDER-OK ${manifest.length} PNGs`);
  for (const m of manifest) console.log(`  ${m.size}  ${m.file}`);
  console.log(`  xml   ${path.relative(ROOT, path.join(anydpi, 'ic_launcher.xml'))} (+ round, background, monochrome)`);
  console.log(`  json  ${path.relative(ROOT, path.join(IOS_APPICON, 'Contents.json'))}`);
}

// Run only when invoked directly (never when imported by the unit tests).
if ((process.argv[1] || '').replace(/\\/g, '/').endsWith('scripts/brand/renderIcons.mjs')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
