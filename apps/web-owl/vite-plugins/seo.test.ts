import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_PAGES, type PublicPageName } from '../src/seo/pages';
import { pageFile, robotsTxt, sitemapXml, withHead } from './seo';

const SITE = 'https://onsite.example';

describe('withHead', () => {
  const shell = `<html>\n  <head>\n    <meta charset="UTF-8" />\n    <title>Old</title>\n    <meta\n      name="description"\n      content="Old description"\n    />\n  </head>\n  <body></body>\n</html>`;

  it('replaces the shell title and description with the page head, keeping the rest', () => {
    const html = withHead(shell, '<title>New</title>');
    expect(html).toContain('<meta charset="UTF-8" />');
    expect(html).toContain('<title>New</title>');
    expect(html).not.toContain('Old');
    expect(html.match(/<title>/g)).toHaveLength(1);
  });
});

describe('robots.txt', () => {
  it('blocks nothing and points at the sitemap', () => {
    const txt = robotsTxt(SITE);
    expect(txt).not.toMatch(/Disallow:\s*\S/);
    expect(txt).toContain('Sitemap: https://onsite.example/sitemap.xml');
  });
});

describe('sitemap.xml', () => {
  it('lists exactly the indexable pages as absolute URLs', () => {
    const locs = [...sitemapXml(SITE).matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(['https://onsite.example/', 'https://onsite.example/licenses']);
  });
});

/**
 * vercel.json is hand-written, so these tests keep it in step with routes.ts:
 * every route must reach the right HTML file, and every non-indexable route
 * must carry the noindex header. A new route that is not mapped would
 * otherwise 404 in production.
 */
describe('vercel.json routing', () => {
  interface Rewrite {
    source: string;
    destination: string;
  }
  interface HeaderRule {
    source: string;
    headers: { key: string; value: string }[];
  }
  const vercel = JSON.parse(readFileSync(resolve(__dirname, '../vercel.json'), 'utf8')) as {
    rewrites: Rewrite[];
    headers: HeaderRule[];
  };
  const routesSource = readFileSync(resolve(__dirname, '../src/routes.ts'), 'utf8');
  const appRoutes = [...routesSource.matchAll(/route\('([\w-]+)', '([^']+)'/g)].map((m) => ({ name: m[1], path: m[2] ?? '' }));

  // Vercel sources are path-to-regexp patterns; `:param` matches one segment.
  const toRegExp = (source: string) => new RegExp(`^${source.replace(/:\w+/g, '[^/]+')}$`);
  const sample = (path: string) => path.replace(/:\w+/g, 'abc123');
  const destination = (path: string) => vercel.rewrites.find((r) => toRegExp(r.source).test(path))?.destination;
  const noindexHeader = (path: string) =>
    vercel.headers.some(
      (rule) => toRegExp(rule.source).test(path) && rule.headers.some((h) => h.key === 'X-Robots-Tag' && h.value.includes('noindex')),
    );

  it('finds the signed-in routes in routes.ts', () => {
    expect(appRoutes.length).toBeGreaterThan(15);
  });

  it('sends every signed-in route to the noindex app shell', () => {
    for (const route of appRoutes) {
      expect(destination(sample(route.path)), route.path).toBe('/app.html');
      expect(noindexHeader(sample(route.path)), route.path).toBe(true);
    }
  });

  it('sends every public page to its own HTML file, with noindex unless indexable', () => {
    for (const [name, page] of Object.entries(PUBLIC_PAGES) as [PublicPageName, (typeof PUBLIC_PAGES)[PublicPageName]][]) {
      if (page.path === '/') continue; // served directly as index.html
      expect(destination(page.path), page.path).toBe(`/${pageFile(name)}`);
      expect(noindexHeader(page.path), page.path).toBe(!page.index);
    }
  });

  it('leaves unknown URLs unmatched so Vercel answers with 404.html and a 404 status', () => {
    expect(destination('/this-page-does-not-exist')).toBeUndefined();
    expect(destination('/tasks/abc/extra')).toBeUndefined();
  });

  it('never noindexes the indexable pages', () => {
    expect(noindexHeader('/')).toBe(false);
    expect(noindexHeader('/licenses')).toBe(false);
  });
});
