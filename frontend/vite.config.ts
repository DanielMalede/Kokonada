import path from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readCurrentNonce } from './scripts/rotate-csp-nonce.mjs'

// Stamps the CSP nonce (rotated into vercel.json by the `prebuild` script — see
// scripts/rotate-csp-nonce.mjs) onto every <script> tag in the built index.html, so
// the enforcing `script-src 'nonce-<value>' 'strict-dynamic'` header always matches
// the HTML actually served.
//
// Uses `closeBundle` (fires after the FINAL index.html is written to disk) rather
// than `transformIndexHtml` (in-memory, pre-write): VitePWA injects its own
// registerSW.js <script> tag, and depending on plugin/hook ordering that injection
// can happen AFTER a transformIndexHtml-based nonce pass runs, leaving that one tag
// un-nonced (CSP would then silently block the service-worker registration).
// Reading the real on-disk file at closeBundle time guarantees every <script> tag
// from every plugin is present before we patch it. Build-only: local `vite dev`
// isn't served through Vercel's headers, so there's nothing to match against in dev.
function cspNoncePlugin(): Plugin {
  let outDir = 'dist'
  let root = process.cwd()
  return {
    name: 'kokonada-csp-nonce',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = config.build.outDir
    },
    closeBundle() {
      const nonce = readCurrentNonce()
      if (!nonce) return // fresh checkout, prebuild hasn't run yet — leave untouched
      const htmlPath = path.resolve(root, outDir, 'index.html')
      if (!existsSync(htmlPath)) return
      const html = readFileSync(htmlPath, 'utf8')
      const patched = html.replace(/<script(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`)
      if (patched !== html) writeFileSync(htmlPath, patched)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'favicon-32x32.png', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Kokonada',
        short_name: 'Kokonada',
        description: 'Mood-driven AI music — playlists that match how you feel.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#7c3aed',
        background_color: '#0b0b12',
        categories: ['music', 'lifestyle', 'entertainment'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
    cspNoncePlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
