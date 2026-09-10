import type { MetadataRoute } from 'next';

/**
 * PWA manifest. This, plus a service worker (added in Phase 8 alongside Web
 * Push), is what makes the worker app "installable" without an app store.
 * See docs/05-system-architecture.md and docs/19-ui-design-system.md.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'OnSite',
    short_name: 'OnSite',
    description: 'Someone on the ground, wherever you need them.',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf9f7',
    theme_color: '#2b4fd8',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
