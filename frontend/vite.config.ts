import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const isProduction = mode === 'production'
  const root = fileURLToPath(new URL('.', import.meta.url))
  const env = loadEnv(mode, root, '')
  // Build-only token file; never expose SENTRY_* values via Vite's client env.
  const sentryEnv = loadEnv('sentry-build-plugin', root, 'SENTRY_')
  const authToken = sentryEnv.SENTRY_AUTH_TOKEN?.trim()
  const uploadRequested = sentryEnv.SENTRY_UPLOAD_SOURCEMAPS
  const uploadSourceMaps = command === 'build' &&
    (uploadRequested === 'true' || (uploadRequested !== 'false' && Boolean(authToken)))
  if (uploadSourceMaps && !authToken) {
    throw new Error('SENTRY_AUTH_TOKEN is required when SENTRY_UPLOAD_SOURCEMAPS=true')
  }
  const desktopVersion = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')).version
  const appVersion = env.VITE_APP_VERSION || desktopVersion
  
  return {
    plugins: [
      react(),
      ...(uploadSourceMaps ? [sentryVitePlugin({
        org: sentryEnv.SENTRY_ORG || 'autovideoclip-ts',
        project: sentryEnv.SENTRY_PROJECT || 'autovideoclip-frontend',
        authToken,
        telemetry: false,
        release: {
          // Must match src/desktop/sentry.ts exactly.
          name: `autovideoclip-frontend@${appVersion}`,
          inject: false,
        },
        sourcemaps: {
          assets: `${root}dist/**`,
          filesToDeleteAfterUpload: [`${root}dist/**/*.map`],
        },
      })] : []),
    ],
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    },
    base: isProduction ? './' : '/', // The production environment uses relative paths
    optimizeDeps: {
      include: ['@tauri-apps/api', '@tauri-apps/api/dialog']
    },
    build: {
      sourcemap: uploadSourceMaps ? 'hidden' : false,
      assetsInlineLimit: 4096,
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        external: [],
        // NOTE: do NOT hand-split React and antd into separate vendor chunks.
        // antd's top-level code calls React.createContext at module-eval time;
        // when React and antd are in different chunks, the chunk load order is
        // not guaranteed and antd can evaluate before React's CJS-interop is
        // initialized, leaving `React` undefined → "Cannot read properties of
        // undefined (reading 'createContext')" → blank/black screen. Letting
        // Rollup decide chunking keeps React's evaluation ordered correctly.
      },
      // Disabled in production environment Service Worker
      serviceWorker: false
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@provider-presets': fileURLToPath(new URL('../backend/presets/provider_presets.json', import.meta.url)),
        '@provider-quality': fileURLToPath(new URL('../backend/presets/provider_quality.json', import.meta.url)),
        '@event-catalog': fileURLToPath(new URL('../backend/core/event_catalog.json', import.meta.url)),
        '@failure-messages': fileURLToPath(new URL('../backend/core/failure_messages.json', import.meta.url)),
      },
    },
    server: {
      port: 3000,
      strictPort: true, // Report an error if the port is occupied，Instead ofAutoSwitch
      hmr: {
        overlay: false // Disable error overlay
      },
      proxy: {
        '/api': {
          // Override when the desktop backend (random port) is running: BACKEND_URL=http://127.0.0.1:PORT npm run dev
          target: process.env.BACKEND_URL || 'http://localhost:8000',
          changeOrigin: true
        }
      }
    }
  }
})
