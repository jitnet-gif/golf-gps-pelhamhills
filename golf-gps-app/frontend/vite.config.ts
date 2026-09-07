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
          // Cache tiles first (but with expiration)
          {
            urlPattern: /.*\.(?:png|jpg|jpeg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tile-cache',
              expiration: {
                maxEntries: 500,
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

    // Rollup options for manual code splitting
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunks to optimize caching
          'vendor-react': ['react', 'react-dom', 'wouter'],
          'vendor-map': ['leaflet', 'react-leaflet'],
          'vendor-ui': ['lucide-react', '@radix-ui/react-dialog'],
          'vendor-utils': ['zod', 'tailwind-merge', 'zustand', 'dexie'],
        },
      },
    },
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
