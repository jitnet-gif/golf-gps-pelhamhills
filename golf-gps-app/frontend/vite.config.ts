import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Plugins for React and JSX support
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Golf GPS App',
        short_name: 'Golf GPS',
        description: 'Real-time golf course GPS and scorecard app',
        theme_color: '#1e40af',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-maskable-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        screenshots: [
          {
            src: '/screenshot-1.png',
            sizes: '540x720',
            type: 'image/png',
            form_factor: 'narrow',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          // Map tiles. Esri World Imagery serves them extension-less
          // (/MapServer/tile/{z}/{y}/{x}), so matching on ".png" cached nothing
          // at all - which is the whole offline story on a fairway with no bars.
          // Anchored at ^: Workbox ignores a RegExp route on a cross-origin
          // request unless the match starts at the very beginning of the URL.
          {
            urlPattern: /^https?:\/\/[^/]+\/.*\/MapServer\/tile\/\d+\/\d+\/\d+(?:\?.*)?$/,
            handler: 'CacheFirst',
            options: {
              // Keep in step with TILE_CACHE_NAME in src/lib/tiles.ts.
              cacheName: 'tile-cache',
              expiration: {
                // A whole-course download is ~536 tiles at zoom 15-19; the rest
                // is headroom for panning, so a pre-round download does not
                // evict itself. Satellite imagery does not go stale in a week.
                maxEntries: 800,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // Everything else pictorial: app artwork, or a self-hosted tile
          // pyramid if VITE_TILE_URL is ever pointed at one.
          {
            urlPattern: /.*\.(?:png|jpg|jpeg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          // Network-first for API calls
          {
            urlPattern: /^https:\/\/.*\/api\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 5 * 60, // 5 minutes
              },
              networkTimeoutSeconds: 3,
            },
          },
        ],
      },
    }),
  ],

  // Path aliases for cleaner imports
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared/src'),
    },
  },

  // Build configuration
  build: {
    // Output directory for production build
    outDir: 'dist',
    emptyOutDir: true,

    // Chunk size limit (warn if exceeded)
    chunkSizeWarningLimit: 1000,

    // No manualChunks. Pinning react/react-dom to their own chunk while
    // react-leaflet and lucide-react sit in others let a consumer chunk
    // evaluate first, so react-dom read React's internals before React had
    // initialised and the page died with __SECRET_INTERNALS...undefined.
    // Rollup's own splitting keeps shared dependencies ordered correctly.
  },

  // Development server configuration
  server: {
    // Proxy API requests to backend
    proxy: {
      '/api': {
        // Change target to your backend URL
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
