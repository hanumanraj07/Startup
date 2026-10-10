/** Whole hours until a deadline, never negative. */
export function hoursLeft(deadlineAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.round((new Date(deadlineAt).getTime() - now) / 3_600_000));
}

/** "Sep 2026"-style month and year for the member-since line. */
export function formatMemberSince(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}

/** A working radius in whole kilometres, e.g. 15000 -> "15". */
export function radiusKm(meters: number): string {
  return (meters / 1000).toFixed(0);
}
