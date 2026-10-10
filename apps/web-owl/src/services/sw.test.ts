import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/**
 * Runs public/sw.js against fake `self`, `caches` and `fetch`. A real worker
 * cannot be registered in every environment (the in-app browser refuses), and
 * what matters here is the caching rule, which is plain logic.
 */

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}
interface WorkerEvent {
  request?: FakeRequest;
  data?: { json: () => unknown; text: () => string } | null;
  notification?: { close: () => void; data?: { url?: string } };
  waitUntil: (p: Promise<unknown>) => void;
  respondWith: (p: Promise<Response> | Response) => void;
}

const SOURCE = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');
const ORIGIN = 'https://onsite.example';

function req(path: string, init: Partial<FakeRequest> = {}): FakeRequest {
  return { url: `${ORIGIN}${path}`, method: 'GET', mode: 'no-cors', ...init };
}

function load(fetchImpl: (r: FakeRequest) => Promise<Response>) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const stores = new Map<string, Map<string, Response>>();

  const cacheFor = (name: string) => {
    let store = stores.get(name);
    if (!store) stores.set(name, (store = new Map()));
    const s = store;
    return {
      addAll: async (urls: string[]) => {
        for (const u of urls) s.set(`${ORIGIN}${u}`, new Response(`cached ${u}`));
      },
      put: async (r: FakeRequest, res: Response) => {
        s.set(r.url, res);
      },
    };
  };
  const lookup = (r: FakeRequest | string) => {
    const key = typeof r === 'string' ? `${ORIGIN}${r}` : r.url;
    for (const store of stores.values()) {
      const hit = store.get(key);
      if (hit) return hit.clone();
    }
    return undefined;
  };

  const clients = {
    claim: vi.fn(async () => undefined),
    matchAll: vi.fn(async () => [] as { url: string; focus: () => Promise<void> }[]),
    openWindow: vi.fn(async (_url: string) => undefined),
  };
  const registration = { showNotification: vi.fn(async (_title: string, _options: unknown) => undefined) };
  const self = {
    addEventListener: (type: string, fn: (event: WorkerEvent) => void) => listeners.set(type, fn),
    skipWaiting: vi.fn(async () => undefined),
    clients,
    registration,
  };
  const caches = {
    open: async (name: string) => cacheFor(name),
    match: async (r: FakeRequest | string) => lookup(r),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };

  new Function('self', 'caches', 'fetch', 'Response', 'URL', SOURCE)(self, caches, fetchImpl, Response, URL);

  /** Dispatch an event and collect what the worker asked to wait on or respond with. */
  async function dispatch(type: string, partial: Partial<WorkerEvent> = {}) {
    const pending: Promise<unknown>[] = [];
    let responded: Promise<Response> | Response | undefined;
    const event: WorkerEvent = {
      waitUntil: (p) => pending.push(p),
      respondWith: (p) => {
        responded = p;
      },
      ...partial,
    };
    const handler = listeners.get(type);
    if (!handler) throw new Error(`no ${type} listener`);
    handler(event);
    await Promise.all(pending);
    return { responded: responded === undefined ? undefined : await responded, intercepted: responded !== undefined };
  }

  return { dispatch, stores, self, clients, registration };
}

/** The paths held in the first (only) cache the worker created. */
function cachedPaths(stores: Map<string, Map<string, Response>>): string[] {
  const store = [...stores.values()][0];
  if (!store) throw new Error('the worker created no cache');
  return [...store.keys()].map((u) => new URL(u).pathname);
}

const online = async () => new Response('network');
const offline = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch');
};

describe('install and activate', () => {
  it('precaches the offline page and activates immediately', async () => {
    const sw = load(online);
    await sw.dispatch('install');
    const cached = cachedPaths(sw.stores);
    expect(cached).toContain('/offline.html');
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it('deletes caches from other versions and claims clients', async () => {
    const sw = load(online);
    sw.stores.set('onsite-shell-v2', new Map()); // the Next.js app's cache
    await sw.dispatch('install');
    await sw.dispatch('activate');
    expect([...sw.stores.keys()]).toEqual(['onsite-shell-owl-v1']);
    expect(sw.clients.claim).toHaveBeenCalled();
  });
});

describe('fetch', () => {
  it('never intercepts API or realtime calls, nor non-GET requests', async () => {
    const sw = load(online);
    expect((await sw.dispatch('fetch', { request: req('/api/v1/tasks/mine') })).intercepted).toBe(false);
    expect((await sw.dispatch('fetch', { request: req('/socket.io/?EIO=4') })).intercepted).toBe(false);
    expect((await sw.dispatch('fetch', { request: req('/assets/app.js', { method: 'POST' }) })).intercepted).toBe(false);
  });

  it('serves a navigation from the network when online', async () => {
    const sw = load(online);
    await sw.dispatch('install');
    const { responded } = await sw.dispatch('fetch', { request: req('/dashboard', { mode: 'navigate' }) });
    expect(await responded?.text()).toBe('network');
  });

  it('falls back to the cached offline page when a navigation fails', async () => {
    const sw = load(offline);
    await sw.dispatch('install');
    const { responded } = await sw.dispatch('fetch', { request: req('/dashboard', { mode: 'navigate' }) });
    expect(await responded?.text()).toBe('cached /offline.html');
  });

  it('caches a static file on first fetch, then serves it from the cache', async () => {
    const fetchImpl = vi.fn(online);
    const sw = load(fetchImpl);
    await sw.dispatch('install');
    const first = await sw.dispatch('fetch', { request: req('/assets/app-abc.js') });
    expect(await first.responded?.text()).toBe('network');
    await new Promise((r) => setTimeout(r, 0)); // the cache write is not awaited by the worker
    const second = await sw.dispatch('fetch', { request: req('/assets/app-abc.js') });
    expect(await second.responded?.text()).toBe('network');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed response', async () => {
    const sw = load(async () => new Response('nope', { status: 500 }));
    await sw.dispatch('install');
    await sw.dispatch('fetch', { request: req('/assets/missing.js') });
    await new Promise((r) => setTimeout(r, 0));
    const cached = cachedPaths(sw.stores);
    expect(cached).not.toContain('/assets/missing.js');
  });
});

describe('push', () => {
  it('shows a notification, defaulting the destination to the dashboard', async () => {
    const sw = load(online);
    await sw.dispatch('push', { data: { json: () => ({ title: 'Task update', body: 'Proof submitted' }), text: () => '' } });
    expect(sw.registration.showNotification).toHaveBeenCalledWith(
      'Task update',
      expect.objectContaining({ body: 'Proof submitted', data: { url: '/dashboard' } }),
    );
  });

  it('falls back to a plain-text body when the payload is not JSON', async () => {
    const sw = load(online);
    await sw.dispatch('push', {
      data: {
        json: () => {
          throw new SyntaxError('bad json');
        },
        text: () => 'plain words',
      },
    });
    expect(sw.registration.showNotification).toHaveBeenCalledWith('OnSite', expect.objectContaining({ body: 'plain words' }));
  });

  it('ignores a push with no data', async () => {
    const sw = load(online);
    await sw.dispatch('push', { data: null });
    expect(sw.registration.showNotification).not.toHaveBeenCalled();
  });

  it('opens the notification target on click, focusing an existing window instead if there is one', async () => {
    const sw = load(online);
    const close = vi.fn();
    await sw.dispatch('notificationclick', { notification: { close, data: { url: '/tasks/1' } } });
    expect(close).toHaveBeenCalled();
    expect(sw.clients.openWindow).toHaveBeenCalledWith('/tasks/1');

    const focus = vi.fn(async () => undefined);
    sw.clients.matchAll.mockResolvedValueOnce([{ url: `${ORIGIN}/tasks/2`, focus }]);
    await sw.dispatch('notificationclick', { notification: { close, data: { url: '/tasks/2' } } });
    expect(focus).toHaveBeenCalled();
  });
});
