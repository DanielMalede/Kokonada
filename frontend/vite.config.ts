import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// NOTE on CSP (see scripts/csp.mjs for the full history): this build no longer stamps
// a per-build nonce onto <script> tags. vercel.json's Content-Security-Policy is now a
// fully static, host-allowlist-only policy with no nonce/'strict-dynamic' — Vercel
// reads vercel.json from the git-committed source before the Build Command runs, so a
// nonce mutated in at build time could never match what the header actually served
// (T3-1: a guaranteed CSP violation, i.e. a blank app, on every real deploy).

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
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
