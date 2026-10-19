/**
 * Whether two people's names plausibly belong to the same person, as banks
 * and government records spell them differently: order, middle names,
 * initials, titles and punctuation all vary. Used to check that a payout
 * account belongs to the verified person, so earnings cannot be routed to a
 * third party's account.
 *
 *   MATCH     the same words, in any order
 *   PARTIAL   every word of the shorter name is in the longer one (an initial
 *             counts for a word starting with it), and at least one full
 *             word matched: "Rahul Sharma" ~ "Rahul Kumar Sharma", "R Sharma"
 *   MISMATCH  anything else
 *
 * MATCH and PARTIAL are accepted for payouts; MISMATCH is not.
 */
export type NameMatch = 'MATCH' | 'PARTIAL' | 'MISMATCH';

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'sri', 'smt', 'kumari', 'km', 'master']);

export function nameTokens(name: string): string[] {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !TITLES.has(t));
}

export function compareNames(a: string, b: string): NameMatch {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.length === 0 || right.length === 0) return 'MISMATCH';

  const sortedLeft = [...left].sort().join(' ');
  const sortedRight = [...right].sort().join(' ');
  if (sortedLeft === sortedRight) return 'MATCH';

  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  const pool = [...longer];
  let fullWordMatched = false;
  for (const word of shorter) {
    let index = pool.indexOf(word);
    if (index >= 0) {
      if (word.length > 1) fullWordMatched = true;
    } else if (word.length === 1) {
      index = pool.findIndex((candidate) => candidate.startsWith(word));
    } else {
      // A full word in the shorter name may be an initial in the longer one.
      index = pool.findIndex((candidate) => candidate.length === 1 && word.startsWith(candidate));
    }
    if (index < 0) return 'MISMATCH';
    pool.splice(index, 1);
  }
  return fullWordMatched ? 'PARTIAL' : 'MISMATCH';
}

export function isAcceptableMatch(match: NameMatch): boolean {
  return match === 'MATCH' || match === 'PARTIAL';
}
