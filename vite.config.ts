import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { version as pkgVersion } from './package.json'

const isStaging = process.env.VITE_APP_ENV === 'staging'
const base = process.env.VITE_BASE || '/Cc-bill/'
const appVersion = process.env.VITE_APP_VERSION || pkgVersion

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_ENV__: JSON.stringify(isStaging ? 'staging' : 'production'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: isStaging ? 'CC Bill (Staging)' : 'CC Bill',
        short_name: isStaging ? 'CCBill STG' : 'CCBill',
        description: 'Shared credit card expense tracker',
        theme_color: isStaging ? '#b45309' : '#1d4ed8',
        background_color: '#f9fafb',
        display: 'standalone',
        orientation: 'portrait',
        scope: base,
        start_url: base,
        icons: [
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Production's service worker scope also covers /staging/; never let it serve staging pages.
        navigateFallbackDenylist: isStaging ? [] : [/\/staging\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.anthropic\.com\/.*/i,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: isStaging ? 'cdn-cache-staging' : 'cdn-cache',
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
})
