import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { thirdPartyLicenses } from './vite-plugins/licenses';
import { seoPages } from './vite-plugins/seo';

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

// The canonical origin for canonical URLs, Open Graph, the sitemap and
// robots.txt. On Vercel it comes from the project's production domain, so it
// follows a custom domain automatically; VITE_SITE_URL overrides it. A Vercel
// build without either fails rather than publishing localhost canonicals.
function siteUrl(): string {
  if (process.env.VITE_SITE_URL) return process.env.VITE_SITE_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL) throw new Error('No site URL: set VITE_SITE_URL or expose Vercel system environment variables.');
  return 'http://localhost:4173';
}
const SITE_URL = siteUrl();

export default defineConfig({
  plugins: [thirdPartyLicenses(), seoPages(SITE_URL)],
  define: { __SITE_URL__: JSON.stringify(SITE_URL) },
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
    rollupOptions: {
      output: {
        // OWL is LGPL-3.0: ship it as its own file so it stays a separable,
        // replaceable library rather than being merged into our code, and
        // keep OWL's real export names on that boundary so a different OWL
        // build can be dropped in without matching minifier-generated names.
        minifyInternalExports: false,
        manualChunks(id) {
          if (id.replace(/\\/g, '/').includes('/node_modules/@odoo/owl/')) return 'owl';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'vite-plugins/**/*.test.ts'],
  },
});
