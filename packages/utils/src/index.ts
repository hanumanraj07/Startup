/**
 * Shared helpers. Runtime-neutral: no Node built-ins, no DOM assumptions,
 * so a React Native app could consume this package unchanged.
 */

export * from './redaction';

// ─── Distance ────────────────────────────────────────────────────────────

/**
 * Formats a distance for display.
 *
 * Distances always come from PostGIS on the server. This never computes one;
 * it only renders what the server measured.
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1_000) return `${Math.round(meters)} m`;
  const km = meters / 1_000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

// ─── Time ────────────────────────────────────────────────────────────────

/**
 * A short, human deadline description. Deliberately plain: no urgency
 * devices, no manufactured pressure. See docs/19-ui-design-system.md.
 */
export function formatTimeRemaining(deadline: Date, now: Date = new Date()): string {
  const ms = deadline.getTime() - now.getTime();
  if (ms <= 0) return 'Overdue';

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m left` : `${hours}h left`;
  }

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day left' : `${days} days left`;
}

export function isPast(date: Date, now: Date = new Date()): boolean {
  return date.getTime() <= now.getTime();
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}

// ─── Cursor pagination ───────────────────────────────────────────────────

/**
 * Opaque, URL-safe cursors.
 *
 * Deliberately built from encodeURIComponent rather than base64: Buffer is a
 * Node built-in and btoa/TextEncoder require the DOM or Node type libraries,
 * any of which would break this package's runtime neutrality.
 *
 * Cursors are opaque to callers but are not secrets and carry no authority.
 * Every endpoint re-checks authorization regardless of the cursor presented.
 */
export function encodeCursor(payload: Record<string, string | number>): string {
  return encodeURIComponent(JSON.stringify(payload));
}

export function decodeCursor<T = Record<string, string | number>>(cursor: string): T | null {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(cursor));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

// ─── Text ────────────────────────────────────────────────────────────────

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function truncate(input: string, max: number): string {
  return input.length <= max ? input : `${input.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Masks all but the last four characters. For account numbers in the UI. */
export function maskTail(value: string, visible = 4): string {
  if (value.length <= visible) return '•'.repeat(value.length);
  return '•'.repeat(value.length - visible) + value.slice(-visible);
}

// ─── Misc ────────────────────────────────────────────────────────────────

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Removes undefined values so they are not serialized as explicit nulls. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
