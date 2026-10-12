import {
  headMeta,
  headTags,
  landingJsonLd,
  PUBLIC_PAGES,
  SITE_NAME,
  type PublicPageName,
} from '../src/seo/pages';

// Just the parts of the Rollup plugin API used here (see licenses.ts for why
// this is structural rather than Vite's Plugin type).
interface BundleOutput {
  type: 'chunk' | 'asset';
  source?: string | Uint8Array;
}
interface EmitContext {
  emitFile(file: { type: 'asset'; fileName: string; source: string }): string;
}
export interface SeoPlugin {
  name: string;
  apply: 'build';
  generateBundle: {
    order: 'post';
    handler(this: EmitContext, options: unknown, bundle: Record<string, BundleOutput>): void;
  };
}

/** Where each public page's HTML is written; vercel.json rewrites the clean path to it. */
export function pageFile(name: PublicPageName): string {
  return name === 'landing' ? 'index.html' : `pages/${name}.html`;
}

/** Swap the shell's generic title and description for a page's own head tags. */
export function withHead(shell: string, tags: string): string {
  const stripped = shell
    .replace(/\s*<title>[\s\S]*?<\/title>/, '')
    .replace(/\s*<meta\s+name="description"[\s\S]*?\/>/, '');
  return stripped.replace(/\s*<\/head>/, `\n    ${tags}\n  </head>`);
}

export function robotsTxt(siteUrl: string): string {
  // Nothing is disallowed: private pages are kept out of the index with
  // noindex (header and meta), which only works if crawlers may fetch them.
  return `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', siteUrl).href}\n`;
}

export function sitemapXml(siteUrl: string): string {
  const urls = Object.values(PUBLIC_PAGES)
    .filter((page) => page.index)
    .map((page) => `  <url>\n    <loc>${new URL(page.path, siteUrl).href}</loc>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/**
 * The app renders in the browser, so without this every URL would share
 * index.html's <head>. At build time, writes:
 *  - index.html and pages/<name>.html: each public page with its own title,
 *    description, robots, canonical, Open Graph and (landing only) JSON-LD;
 *  - app.html: the shell for signed-in routes, noindex, no canonical;
 *  - 404.html: the shell for unknown URLs, which Vercel serves with a 404 status;
 *  - robots.txt and sitemap.xml (indexable pages only).
 * vercel.json maps each route to the right file.
 */
export function seoPages(siteUrl: string): SeoPlugin {
  return {
    name: 'onsite-seo-pages',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const index = bundle['index.html'];
        if (!index || typeof index.source !== 'string') throw new Error('seo-pages: index.html was not emitted');
        const shell = index.source;

        for (const name of Object.keys(PUBLIC_PAGES) as PublicPageName[]) {
          const page = PUBLIC_PAGES[name];
          const tags = headTags(headMeta(name, page.title, siteUrl), siteUrl, name === 'landing' ? landingJsonLd(siteUrl) : undefined);
          const html = withHead(shell, tags);
          if (name === 'landing') index.source = html;
          else this.emitFile({ type: 'asset', fileName: pageFile(name), source: html });
        }

        this.emitFile({ type: 'asset', fileName: 'app.html', source: withHead(shell, headTags(headMeta(null, SITE_NAME, siteUrl), siteUrl)) });
        this.emitFile({ type: 'asset', fileName: '404.html', source: withHead(shell, headTags(headMeta(null, null, siteUrl), siteUrl)) });
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(siteUrl) });
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(siteUrl) });
      },
    },
  };
}
