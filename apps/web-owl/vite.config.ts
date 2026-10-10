import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const fromRoot = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Dev proxies /api and /socket.io to the API so the browser sees a single
// origin: the API's CORS allows exactly one origin (WEB_URL) and its refresh
// cookie is SameSite=Lax outside production, so cross-origin dev would break
// the session. Production sets VITE_API_URL instead and needs no proxy.
const API_TARGET = process.env.VITE_DEV_API_TARGET ?? 'http://localhost:4000';
// The Socket.IO gateway rejects any handshake whose Origin is not WEB_URL
// (realtime/cors-origin.ts), and a browser always sends one. The proxy
// presents the API's own allowed origin so the API needs no change in dev.
const API_ALLOWED_ORIGIN = process.env.VITE_DEV_API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  resolve: {
    alias: {
      '@': fromRoot('./src'),
      // The shared packages ship CommonJS dist; alias to their ESM-syntax
      // source (as Next did via transpilePackages) so Vite never has to
      // interop a linked CJS package.
      '@onsite/types': fromRoot('../../packages/types/src/index.ts'),
      '@onsite/validation': fromRoot('../../packages/validation/src/index.ts'),
      '@onsite/money': fromRoot('../../packages/money/src/index.ts'),
      '@onsite/utils': fromRoot('../../packages/utils/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, headers: { Origin: API_ALLOWED_ORIGIN } },
      '/socket.io': { target: API_TARGET, ws: true, headers: { Origin: API_ALLOWED_ORIGIN } },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
