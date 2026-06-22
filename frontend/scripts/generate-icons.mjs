// Generates the PWA icon set for Kokonada from an inline SVG source.
// Run with: npm run gen:icons
// Outputs PNGs into ./public so vite-plugin-pwa can reference them.
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(__dirname, '..', 'public')
mkdirSync(publicDir, { recursive: true })

// Aura gradient + centered equalizer bars. Background is fully opaque so the
// icon looks correct on iOS (no alpha) and when Android masks the corners.
const bars = (scale = 1) => {
  const heights = [150, 240, 320, 220, 140]
  const w = 36
  const gap = 24
  const startX = 256 - (heights.length * w + (heights.length - 1) * gap) / 2
  const rects = heights
    .map((h, i) => {
      const x = startX + i * (w + gap)
      const y = 256 - h / 2
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" />`
    })
    .join('')
  return `<g fill="#ffffff" transform="translate(256,256) scale(${scale}) translate(-256,-256)">${rects}</g>`
}

const gradient = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#7c3aed" />
      <stop offset="0.5" stop-color="#db2777" />
      <stop offset="1" stop-color="#f97316" />
    </linearGradient>
  </defs>`

// Standard icon: rounded square, content fills the canvas.
const iconSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">${gradient}
  <rect width="512" height="512" rx="112" fill="url(#g)" />
  ${bars(1)}
</svg>`

// Maskable icon: full-bleed background, content kept inside the ~62% safe zone
// so Android circular/squircle masks never clip the equalizer.
const maskableSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">${gradient}
  <rect width="512" height="512" fill="url(#g)" />
  ${bars(0.62)}
</svg>`

// Keep the SVGs on disk for the favicon and future edits.
writeFileSync(resolve(publicDir, 'favicon.svg'), iconSvg)

const targets = [
  { svg: iconSvg, size: 192, name: 'pwa-192x192.png' },
  { svg: iconSvg, size: 512, name: 'pwa-512x512.png' },
  { svg: maskableSvg, size: 512, name: 'maskable-icon-512x512.png' },
  { svg: iconSvg, size: 180, name: 'apple-touch-icon.png' },
  { svg: iconSvg, size: 32, name: 'favicon-32x32.png' },
]

for (const { svg, size, name } of targets) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(resolve(publicDir, name))
  console.log(`wrote public/${name} (${size}x${size})`)
}
console.log('wrote public/favicon.svg')
