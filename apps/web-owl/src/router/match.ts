export interface CompiledPath {
  pattern: RegExp;
  keys: string[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiles a route path like `/tasks/:id` into a matcher. Only whole-segment `:param`s are supported. */
export function compilePath(path: string): CompiledPath {
  const keys: string[] = [];
  const source = path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return escapeRegExp(segment);
    })
    .join('/');
  return { pattern: new RegExp(source ? `^/${source}/?$` : '^/$'), keys };
}

/** Returns the decoded params if `pathname` matches, otherwise null. */
export function matchPath(compiled: CompiledPath, pathname: string): Record<string, string> | null {
  const match = compiled.pattern.exec(pathname);
  if (!match) return null;
  const params: Record<string, string> = {};
  for (const [index, key] of compiled.keys.entries()) {
    try {
      params[key] = decodeURIComponent(match[index + 1] ?? '');
    } catch {
      return null;
    }
  }
  return params;
}

export function parseQuery(search: string): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (!(key in query)) query[key] = value;
  }
  return query;
}

/** The title index.html ships with; the landing page keeps it rather than becoming "OnSite · OnSite". */
export const DEFAULT_TITLE = 'OnSite — someone on the ground, wherever you need them';

/** The document title for a matched route's title, or for no match (null). */
export function pageTitle(routeTitle: string | null): string {
  if (routeTitle === null) return 'Not found · OnSite';
  return routeTitle === 'OnSite' ? DEFAULT_TITLE : `${routeTitle} · OnSite`;
}
