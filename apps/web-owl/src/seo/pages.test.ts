import { describe, expect, it } from 'vitest';
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, headMeta, headTags, landingJsonLd, pageTitle, PUBLIC_PAGES } from './pages';

const SITE = 'https://onsite.example';

describe('pageTitle', () => {
  it('suffixes a route title with the product name', () => {
    expect(pageTitle('Dashboard')).toBe('Dashboard · OnSite');
  });

  it('keeps the full tagline on the landing page instead of "OnSite · OnSite"', () => {
    expect(pageTitle('OnSite')).toBe(DEFAULT_TITLE);
  });

  it('has a title for an unmatched route', () => {
    expect(pageTitle(null)).toBe('Not found · OnSite');
  });
});

describe('PUBLIC_PAGES', () => {
  const pages = Object.values(PUBLIC_PAGES);

  it('gives every public page its own title and description', () => {
    expect(new Set(pages.map((p) => p.title)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.description)).size).toBe(pages.length);
  });

  it('indexes only the landing and licences pages', () => {
    expect(pages.filter((p) => p.index).map((p) => p.path)).toEqual(['/', '/licenses']);
  });
});

describe('headMeta', () => {
  it('describes an indexable page with its own canonical', () => {
    expect(headMeta('licenses', null, SITE)).toEqual({
      title: 'Open-source licences · OnSite',
      description: PUBLIC_PAGES.licenses.description,
      robots: 'index, follow',
      canonical: 'https://onsite.example/licenses',
    });
  });

  it('marks a public form noindex but keeps its canonical', () => {
    const meta = headMeta('sign-in', null, SITE);
    expect(meta.robots).toBe('noindex, follow');
    expect(meta.canonical).toBe('https://onsite.example/sign-in');
  });

  it('gives a signed-in route noindex, the generic description and no canonical', () => {
    expect(headMeta('task-detail', 'Task', SITE)).toEqual({
      title: 'Task · OnSite',
      description: DEFAULT_DESCRIPTION,
      robots: 'noindex, follow',
      canonical: null,
    });
  });

  it('treats an unknown URL as not found and noindex', () => {
    const meta = headMeta(null, null, SITE);
    expect(meta.title).toBe('Not found · OnSite');
    expect(meta.robots).toBe('noindex, follow');
    expect(meta.canonical).toBeNull();
  });
});

describe('headTags', () => {
  it('writes canonical, Open Graph and Twitter tags with absolute URLs for a public page', () => {
    const html = headTags(headMeta('landing', null, SITE), SITE);
    expect(html).toContain('<link rel="canonical" href="https://onsite.example/" />');
    expect(html).toContain('<meta property="og:url" content="https://onsite.example/" />');
    expect(html).toContain('<meta property="og:image" content="https://onsite.example/icon-512.png" />');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    expect(html.match(/<title>/g)).toHaveLength(1);
  });

  it('writes no canonical or share card for a private page', () => {
    const html = headTags(headMeta(null, 'OnSite', SITE), SITE);
    expect(html).not.toContain('canonical');
    expect(html).not.toContain('og:');
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
  });

  it('escapes HTML in text content', () => {
    const html = headTags({ title: 'A & B <x>', description: 'say "hi"', robots: 'index, follow', canonical: null }, SITE);
    expect(html).toContain('<title>A &amp; B &lt;x&gt;</title>');
    expect(html).toContain('content="say &quot;hi&quot;"');
  });

  it('embeds JSON-LD that parses back to the same object and cannot close its script early', () => {
    const data = { name: '</script><b>' };
    const html = headTags(headMeta('landing', null, SITE), SITE, data);
    const json = /<script type="application\/ld\+json">(.*)<\/script>/.exec(html)?.[1] ?? '';
    expect(json).not.toContain('</script>');
    expect(JSON.parse(json)).toEqual(data);
  });
});

describe('landingJsonLd', () => {
  it('describes the site and organisation with only facts the page shows', () => {
    const ld = landingJsonLd(SITE) as { '@graph': Record<string, unknown>[] };
    const [site, org] = ld['@graph'];
    expect(site).toMatchObject({ '@type': 'WebSite', name: 'OnSite', url: 'https://onsite.example/', description: DEFAULT_DESCRIPTION });
    expect(org).toMatchObject({ '@type': 'Organization', name: 'OnSite', logo: 'https://onsite.example/icon-512.png' });
    // No invented facts: no ratings, addresses, phone numbers or social profiles.
    expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|address|telephone|sameAs/);
  });
});
