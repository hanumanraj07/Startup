export const config = {
  /**
   * REST calls go to the site's own origin: Vite proxies /api in dev, and
   * vercel.json rewrites /api/v1/* to the API in production. Same-origin is
   * what makes the refresh cookie first-party; as a cross-site (third-party)
   * cookie, Safari, iOS and privacy-strict browsers dropped it, which signed
   * people out whenever they came back. Set VITE_API_BASE only to bypass the
   * proxy deliberately.
   */
  apiUrl: import.meta.env.VITE_API_BASE ?? '',
  /**
   * Socket.IO connects to the API directly — Vercel rewrites cannot carry a
   * WebSocket. Authentication there is the in-memory access token, not the
   * cookie, so cross-site is fine. Empty in dev (Vite proxies /socket.io).
   */
  socketUrl: import.meta.env.VITE_SOCKET_URL ?? import.meta.env.VITE_API_URL ?? '',
  /** Raster map tiles. OpenStreetMap's own servers by default (light use, attribution required). */
  mapTileUrl: import.meta.env.VITE_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
};
