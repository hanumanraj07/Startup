/**
 * Server-side contact-info redaction for task chat. docs/13-notification-system.md
 * and docs/09-task-lifecycle.md both require that a requester and worker never
 * exchange phone numbers, email addresses or UPI handles through the
 * platform — the whole point of routing communication through OnSite is that
 * it stays intermediated. `redactedBody` is what every client ever receives;
 * `body` (the raw text) is retained only as dispute evidence and is never
 * sent over the wire — see the Message model's own comment in schema.prisma.
 *
 * This is pattern matching, not a parser, and it is honest about that: it
 * catches the common, unobfuscated forms (a bare phone number, a standard
 * email address, a UPI-style handle) but not deliberate evasion — digits
 * spelled out as words, a number split across several messages, unicode
 * homoglyphs. Closing those gaps needs a much larger effort (and arguably a
 * model, not a regex) and is out of scope here; this stops the overwhelming
 * majority of accidental leaks, which is what actually happens in practice.
 */

export type RedactionFlag = 'phone' | 'email' | 'upi';

export interface RedactionResult {
  redactedBody: string;
  flags: RedactionFlag[];
}

// Order matters: email must run before the UPI heuristic, since a UPI handle
// is (loosely) "email-shaped but without a dotted domain", and matching email
// first prevents an email address from also being flagged as a UPI id.

/**
 * Indian mobile numbers, optionally prefixed with a trunk `0` or `+91`, with
 * an optional space/dash between any two digits — covers the common
 * groupings (5-5, 3-3-4, or none) rather than assuming one specific layout.
 *
 * The `\b` sits BEFORE the whole optional prefix, not between the prefix and
 * the first mobile digit — found live, the hard way, from a real message
 * that leaked a phone number in full: `\b` only matches at a transition
 * between a word character and a non-word one, and two adjacent digits are
 * both "word" characters, so a `\b` placed between a digit prefix (a trunk
 * `0`, or the `91` of a country code) and the number that follows it can
 * never match — there is no transition to find. The previous version of
 * this pattern anchored `\b` exactly there, so a number typed with a leading
 * trunk `0` (`08209512102`, a common way to write a domestic number) matched
 * nothing at all and passed through unredacted. Anchoring the single `\b` at
 * the very start of the whole prefix+number run instead only requires a
 * boundary where one can actually exist — before the run begins and after it
 * ends — and a prefix immediately followed by more digits needs no boundary
 * of its own, since it is all one contiguous match.
 */
const PHONE_PATTERN = /\b(?:\+?91[-\s]?|0)?[6-9](?:[-\s]?\d){9}\b/g;

const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b/g;

/** UPI VPAs look like an email address but the "domain" has no dot: `name@okhdfcbank`, `98765@ybl`. */
const UPI_PATTERN = /\b[\w.-]{2,}@[a-zA-Z][\w-]{1,}\b/g;

/**
 * Deliberately does not call `.test()` on these shared, module-scoped global
 * regexes to detect a match before replacing: `.test()` with the `g` flag
 * advances the regex's own `lastIndex`, which persists across calls on a
 * shared regex object. A later call on a different, shorter string could then
 * start scanning past where its match actually is and wrongly report no
 * match — the redaction would still happen (`.replace()` with `g` resets
 * `lastIndex` to 0 itself before scanning, per spec), but the returned
 * `flags` could silently miss one. Comparing the string before and after
 * `.replace()` sidesteps the whole class of bug.
 */
export function redactContactInfo(rawBody: string): RedactionResult {
  const flags: RedactionFlag[] = [];
  let redacted = rawBody;

  const afterEmail = redacted.replace(EMAIL_PATTERN, '[email removed]');
  if (afterEmail !== redacted) flags.push('email');
  redacted = afterEmail;

  const afterUpi = redacted.replace(UPI_PATTERN, '[UPI ID removed]');
  if (afterUpi !== redacted) flags.push('upi');
  redacted = afterUpi;

  const afterPhone = redacted.replace(PHONE_PATTERN, '[phone number removed]');
  if (afterPhone !== redacted) flags.push('phone');
  redacted = afterPhone;

  return { redactedBody: redacted, flags };
}
