import { reactive, type Component } from '@odoo/owl';
import { compilePath, matchPath, parseQuery, type CompiledPath } from './match';

export type Layout = 'marketing' | 'auth' | 'app';
/** public: anyone. user: signed in. admin: signed in with platformRole ADMIN. */
export type Guard = 'public' | 'user' | 'admin';

export interface RouteDef {
  name: string;
  path: string;
  title: string;
  layout: Layout;
  guard: Guard;
  component: typeof Component;
}

export interface RouterState {
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  /** Name of the matched route, or null when nothing matched. */
  routeName: string | null;
}

export const routerState = reactive<RouterState>({
  path: '/',
  params: {},
  query: {},
  routeName: null,
});

interface TableEntry {
  def: RouteDef;
  compiled: CompiledPath;
}

let table: TableEntry[] = [];

/** Components should pass `this.router.routeName` (read through useState) so the read is tracked. */
export function routeByName(name: string | null): RouteDef | null {
  return table.find((entry) => entry.def.name === name)?.def ?? null;
}

export function currentRoute(): RouteDef | null {
  return routeByName(routerState.routeName);
}

function syncFromLocation() {
  const { pathname, search } = window.location;
  let matched: { def: RouteDef; params: Record<string, string> } | null = null;
  // First match wins, so fixed paths (/tasks/new) must be listed before
  // their parameterised siblings (/tasks/:id).
  for (const entry of table) {
    const params = matchPath(entry.compiled, pathname);
    if (params) {
      matched = { def: entry.def, params };
      break;
    }
  }
  routerState.path = pathname;
  routerState.query = parseQuery(search);
  routerState.params = matched?.params ?? {};
  routerState.routeName = matched?.def.name ?? null;
  document.title = matched ? `${matched.def.title} · OnSite` : 'Not found · OnSite';
}

export function initRouter(routes: RouteDef[]) {
  table = routes.map((def) => ({ def, compiled: compilePath(def.path) }));
  window.addEventListener('popstate', syncFromLocation);
  syncFromLocation();
}

export function navigate(to: string, options: { replace?: boolean } = {}) {
  const current = window.location.pathname + window.location.search;
  if (to !== current) {
    if (options.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
  }
  syncFromLocation();
  if (!options.replace) window.scrollTo(0, 0);
}
