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
      },
      workbox: {
        importScripts: ['/push-sw.js'],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
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
          // 티 시트 예약 API 는 캐시하지 않는다. 아래 NetworkFirst 규칙에 잡히면
          // 남은 자리 수를 최대 5분 묵은 값으로 보여주고, 손님은 이미 찬 시간을
          // 눌러 409 를 맞는다. 예약 화면은 "못 닿았다" 를 전화 안내로 착지시키므로,
          // 오래된 답을 주느니 실패하는 편이 낫다.
          // 규칙 순서가 곧 우선순위다 - 이 항목이 반드시 아래 /api/ 규칙보다 앞에 온다.
          // 위의 타일 규칙과 같은 이유로 ^ 에 앵커한다: 예약 서버는 교차 출처라
          // (VITE_TEE_SHEET_API_URL), Workbox 는 URL 중간부터 걸리는 RegExp 를 무시한다.
          {
            urlPattern: /^https?:\/\/[^/]+\/.*tee-sheet\/.*/,
            handler: 'NetworkOnly',
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
