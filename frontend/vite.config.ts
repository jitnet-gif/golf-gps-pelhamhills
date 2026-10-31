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
      // 'prompt', not 'autoUpdate'. autoUpdate bakes self.skipWaiting() into the
      // generated worker, so a version deployed mid-round would activate under
      // the open page and cleanupOutdatedCaches() would drop the precache that
      // page is still running from. 'prompt' emits the SKIP_WAITING message
      // listener instead: the new version downloads in the background and waits
      // until src/lib/appUpdate.ts decides the moment is safe to take it.
      registerType: 'prompt',
      // We register the worker ourselves (src/lib/appUpdate.ts) so it can be
      // registered with updateViaCache: 'none' and asked for an update check on
      // our schedule; the injected registerSW.js would only be a second,
      // blinder registration of the same file.
      injectRegister: null,
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
      },
      workbox: {
        importScripts: ['/push-sw.js'],
        // On although 'prompt' defaults it off: a first-ever visit has to end
        // with the worker controlling the page, or the pre-round download in
        // OfflineCourse has nowhere to put tiles until the next reload. A
        // worker only claims when it activates, and with skipWaiting off an
        // update never activates under an open page - so this buys the first
        // visit without costing the round.
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // The admin drone guide (public/admin/drone-guide.html) is staff-only and
        // online-only: not worth precaching onto every player's phone. With it
        // out of the precache, the navigation fallback would answer it with the
        // app shell instead, so it is denied there too.
        globIgnores: ['admin/**'],
        navigateFallbackDenylist: [/^\/admin\/[^/]+\.html$/],
        // maximumFileSizeToCacheInBytes is left at Workbox's default: the
        // narration mp3s are deliberately NOT precached. They are ~4.7 MB all
        // told, and a first visit should not spend that before the player has
        // decided to use the app - the runtime rule below plus the pre-round
        // download in OfflineCourse is the same bargain the map tiles get.
        runtimeCaching: [
          // Hole narration cut with ElevenLabs. CacheFirst because a clip is
          // immutable: rewriting a hole's commentary changes the manifest hash
          // and the generator re-cuts that file, but the file at a given path
          // never changes meaning, so there is nothing to revalidate.
          {
            // Unanchored on purpose, unlike the tile rule below: these are
            // same-origin requests, where Workbox does match a RegExp mid-URL.
            urlPattern: /\/audio\/holes\/[^/]+\.mp3$/,
            handler: 'CacheFirst',
            options: {
              // Keep in step with NARRATION_CACHE_NAME in
              // src/data/narrationAudio.ts.
              cacheName: 'narration-cache',
              expiration: {
                // 126 clips is the whole course (108 card + 18 commentary);
                // the headroom absorbs a re-cut hole without evicting a
                // neighbour. A round is four hours, a season is not - 90 days
                // means one download lasts the summer.
                maxEntries: 160,
                maxAgeSeconds: 90 * 24 * 60 * 60,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
              // Audio is fetched with Range requests by some browsers; without
              // this the partial responses never land in the cache.
              rangeRequests: true,
            },
          },
          // The caddie's yardage, baked with ElevenLabs into one clip per number
          // (scripts/generate-callouts.mjs). Immutable like the hole clips: a
          // re-bake changes the manifest hash and writes a new file.
          {
            urlPattern: /\/audio\/callouts\/[^/]+\.mp3$/,
            handler: 'CacheFirst',
            options: {
              // Keep in step with CALLOUT_AUDIO_PREFIX in src/data/calloutAudio.ts.
              cacheName: 'callout-cache',
              expiration: {
                // One clip per yard to 560, plus a handful of sentence ends.
                maxEntries: 700,
                maxAgeSeconds: 90 * 24 * 60 * 60,
              },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
          // The pro shop's offer on the 8th and the 17th, in the same voice
          // (scripts/generate-hole-ads.mjs). Two files, but they matter more
          // than their size: they are played from a GPS fix with no gesture
          // anywhere near, so the one thing they must not do is wait on a
          // fairway's signal.
          {
            urlPattern: /\/audio\/ads\/[^/]+\.mp3$/,
            handler: 'CacheFirst',
            options: {
              // Keep in step with HOLE_AD_AUDIO_PREFIX in src/data/holeAdAudio.ts.
              cacheName: 'hole-ad-cache',
              expiration: { maxEntries: 20, maxAgeSeconds: 90 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
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
              // v2: the hole cards were redrawn under the same file names, and
              // CacheFirst would keep showing a phone the old ones.
              cacheName: 'image-cache-v2',
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
