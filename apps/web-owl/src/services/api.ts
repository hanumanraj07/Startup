/**
 * Thin fetch wrapper around the API described in docs/07-api-specification.md.
 * A port of apps/web/src/lib/api-client.ts with identical behaviour.
 *
 * The access token lives in memory only (never localStorage); the refresh
 * token is an httpOnly cookie the browser attaches automatically
 * (`credentials: 'include'`), so every reload re-enters through
 * `refreshSession()`.
 */
import { config } from '@/lib/config';

export const API_URL = config.apiUrl;

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/** Called once by the session service so the client can clear state on an unrecoverable 401. */
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  idempotencyKey?: string;
  /** Skip the automatic refresh-and-retry on 401 (used by auth calls and refresh itself). */
  skipAuthRetry?: boolean;
}

let refreshPromise: Promise<boolean> | null = null;

async function requestRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string };
    setAccessToken(data.accessToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * One refresh at a time per tab (refreshPromise) and, through the Web Locks
 * API, one at a time across every tab of the site. Refresh tokens rotate, so
 * two tabs presenting the same cookie at once used to look like token theft
 * and sign the user out everywhere. With the lock, the second tab waits and
 * then refreshes with the cookie the first one just received. The API also
 * tolerates a near-simultaneous duplicate (auth.service.ts) for browsers
 * without Web Locks.
 */
async function refreshUnderLock(): Promise<boolean> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return requestRefresh();
  return await locks.request('onsite-session-refresh', requestRefresh);
}

export async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = refreshUnderLock().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, skipAuthRetry, headers, ...rest } = options;

  const doFetch = () => {
    const finalHeaders: Record<string, string> = {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...(headers as Record<string, string> | undefined),
    };
    return fetch(`${API_URL}/api/v1${path}`, {
      ...rest,
      headers: finalHeaders,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let res = await doFetch();

  if (res.status === 401 && !skipAuthRetry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await doFetch();
    } else {
      setAccessToken(null);
      onSessionExpired?.();
    }
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const shape = (data?.error ?? {}) as Partial<ApiErrorShape>;
    throw new ApiError(
      res.status,
      shape.code ?? 'UNKNOWN_ERROR',
      shape.message ?? 'Something went wrong.',
      shape.details,
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: 'DELETE', body }),
};
