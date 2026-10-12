import { headMeta, landingJsonLd } from './pages';

/** The canonical origin, fixed at build time (vite.config.ts). */
export const SITE_URL: string = __SITE_URL__;

function upsertMeta(attribute: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attribute, key);
    document.head.append(el);
  }
  el.content = content;
}

function removeAll(selector: string) {
  for (const el of document.head.querySelectorAll(selector)) el.remove();
}

/**
 * Keep the <head> in step with client-side navigation: title, description,
 * robots and canonical, plus the Open Graph fields that change per page. The
 * static HTML for each route already carries the same values (built by
 * vite-plugins/seo.ts); this matters for crawlers that run JavaScript and
 * follow links within the app.
 */
export function applyHead(routeName: string | null, routeTitle: string | null) {
  const meta = headMeta(routeName, routeTitle, SITE_URL);
  document.title = meta.title;
  upsertMeta('name', 'description', meta.description);
  upsertMeta('name', 'robots', meta.robots);

  if (meta.canonical) {
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.append(link);
    }
    link.href = meta.canonical;
    upsertMeta('property', 'og:title', meta.title);
    upsertMeta('property', 'og:description', meta.description);
    upsertMeta('property', 'og:url', meta.canonical);
  } else {
    // A private or unknown page must not claim another page's canonical or share card.
    removeAll('link[rel="canonical"], meta[property^="og:"], meta[name^="twitter:"]');
  }

  // Structured data describes the landing page only, as in the static HTML.
  const jsonLd = document.head.querySelector('script[type="application/ld+json"]');
  if (routeName !== 'landing') jsonLd?.remove();
  else if (!jsonLd) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(landingJsonLd(SITE_URL));
    document.head.append(script);
  }
}
