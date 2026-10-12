/**
 * Search and social metadata for the public pages, in one place. Pure (no DOM,
 * no `@/` imports) because the build plugin in vite-plugins/seo.ts imports it
 * too, to write each page's <head> into static HTML that crawlers and link
 * previews read without running JavaScript.
 *
 * Only `/` and `/licenses` are indexable. Login forms and the signed-in app
 * are `noindex`: they have nothing a searcher needs, and the app is private.
 */

export const SITE_NAME = 'OnSite';

/** The landing page's full title, and the title of the HTML shell before the router runs. */
export const DEFAULT_TITLE = 'OnSite — someone on the ground, wherever you need them';

export const DEFAULT_DESCRIPTION =
  'Get a verified local person to inspect, verify, or collect something anywhere in India. Funds held in escrow, released only when you approve the evidence.';

/** The square app icon: the only brand image the project has. Used for link previews. */
export const SHARE_IMAGE = { path: '/icon-512.png', width: 512, height: 512, alt: 'OnSite' };

export interface PageMeta {
  path: string;
  /** Short route title; the document title is built from it by `pageTitle`. */
  title: string;
  description: string;
  index: boolean;
}

/**
 * Keyed by route name (see routes.ts). Every route NOT listed here is part of
 * the signed-in app and is served `noindex` with the generic description.
 */
export const PUBLIC_PAGES = {
  landing: { path: '/', title: SITE_NAME, description: DEFAULT_DESCRIPTION, index: true },
  licenses: {
    path: '/licenses',
    title: 'Open-source licences',
    description: 'The open-source software OnSite sends to your browser and the licence of each package, including OWL under the LGPL v3.',
    index: true,
  },
  offline: {
    path: '/offline',
    title: 'Offline',
    description: 'OnSite needs a connection for live task data. Reconnect and reload to continue.',
    index: false,
  },
  'sign-in': {
    path: '/sign-in',
    title: 'Sign in',
    description: 'Sign in to OnSite to post tasks, accept work near you, and review evidence.',
    index: false,
  },
  'sign-up': {
    path: '/sign-up',
    title: 'Create account',
    description: 'Create an OnSite account to get something inspected or verified anywhere in India, or to earn by doing tasks near you.',
    index: false,
  },
  'forgot-password': {
    path: '/forgot-password',
    title: 'Forgot password',
    description: 'Reset the password for your OnSite account.',
    index: false,
  },
  'reset-password': {
    path: '/reset-password',
    title: 'Reset password',
    description: 'Choose a new password for your OnSite account.',
    index: false,
  },
  'verify-email': {
    path: '/verify-email',
    title: 'Verify email',
    description: 'Confirm the email address for your OnSite account.',
    index: false,
  },
} satisfies Record<string, PageMeta>;

export type PublicPageName = keyof typeof PUBLIC_PAGES;

export function publicPage(routeName: string | null): PageMeta | null {
  if (routeName === null || !(routeName in PUBLIC_PAGES)) return null;
  return PUBLIC_PAGES[routeName as PublicPageName];
}

/** The document title for a route title, or for no match (null). The landing page keeps the full tagline. */
export function pageTitle(routeTitle: string | null): string {
  if (routeTitle === null) return `Not found · ${SITE_NAME}`;
  return routeTitle === SITE_NAME ? DEFAULT_TITLE : `${routeTitle} · ${SITE_NAME}`;
}

/** What the <head> should say for a route. Private and unknown routes get no canonical and `noindex`. */
export interface HeadMeta {
  title: string;
  description: string;
  robots: string;
  /** Absolute canonical URL, or null where a canonical would be meaningless (private and unknown pages). */
  canonical: string | null;
}

export function headMeta(routeName: string | null, routeTitle: string | null, siteUrl: string): HeadMeta {
  const page = publicPage(routeName);
  return {
    title: pageTitle(page ? page.title : routeTitle),
    description: page ? page.description : DEFAULT_DESCRIPTION,
    robots: page?.index ? 'index, follow' : 'noindex, follow',
    canonical: page ? new URL(page.path, siteUrl).href : null,
  };
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * JSON-LD for the landing page. Only facts the page itself shows: the name,
 * the address, the description and the existing icon. No ratings, prices,
 * addresses or social profiles, because none exist to cite.
 */
export function landingJsonLd(siteUrl: string): object {
  const url = new URL('/', siteUrl).href;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${url}#website`,
        name: SITE_NAME,
        url,
        description: DEFAULT_DESCRIPTION,
        inLanguage: 'en-IN',
        publisher: { '@id': `${url}#organization` },
      },
      {
        '@type': 'Organization',
        '@id': `${url}#organization`,
        name: SITE_NAME,
        url,
        logo: new URL(SHARE_IMAGE.path, siteUrl).href,
      },
    ],
  };
}

/**
 * The <head> tags for a page, as HTML. Used at build time for the static
 * pages; the browser keeps the same tags in step on navigation (seo/head.ts).
 */
export function headTags(meta: HeadMeta, siteUrl: string, jsonLd?: object): string {
  const image = new URL(SHARE_IMAGE.path, siteUrl).href;
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="robots" content="${meta.robots}" />`,
  ];
  if (meta.canonical) {
    tags.push(
      `<link rel="canonical" href="${meta.canonical}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${SITE_NAME}" />`,
      `<meta property="og:locale" content="en_IN" />`,
      `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
      `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
      `<meta property="og:url" content="${meta.canonical}" />`,
      `<meta property="og:image" content="${image}" />`,
      `<meta property="og:image:width" content="${SHARE_IMAGE.width}" />`,
      `<meta property="og:image:height" content="${SHARE_IMAGE.height}" />`,
      `<meta property="og:image:alt" content="${SHARE_IMAGE.alt}" />`,
      // A square icon suits the small card; a large card needs a 1200x630 image the project does not have.
      `<meta name="twitter:card" content="summary" />`,
      `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
      `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
      `<meta name="twitter:image" content="${image}" />`,
    );
  }
  if (jsonLd) {
    // `<` is escaped so the JSON can never close the script element early.
    tags.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`);
  }
  return tags.join('\n    ');
}
