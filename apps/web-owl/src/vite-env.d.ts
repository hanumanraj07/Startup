/// <reference types="vite/client" />

/** The canonical site origin, e.g. https://onsite-orcin.vercel.app. Set in vite.config.ts. */
declare const __SITE_URL__: string;

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
