export const config = {
  /** Empty in dev (Vite proxies /api and /socket.io); the API origin in production. */
  apiUrl: import.meta.env.VITE_API_URL ?? '',
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
};
